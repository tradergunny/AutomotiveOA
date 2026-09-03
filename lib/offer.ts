import type { AuthorizationChannel, JobStatus, ProposedAction } from "@/lib/generated/prisma/enums";
import { applyCaseReadiness, type FlowTx } from "@/lib/case-flow";
import {
  AUTH_CHANNELS,
  coveringQuotation,
  partOf,
  pricedOfferLines,
  quotationNumberFor,
  samePart,
  type OfferPart,
} from "@/lib/jobs";
import type { TenantDb } from "@/lib/tenant";

/**
 * The Offer's domain logic (M7.7 brief; D-24, D-20, D-25): what accepting a
 * Finding does to the Jobs, where a Finding freezes, how lines merge, how a
 * Response is recorded as a set, and how Send quotation stamps a version.
 * Pure rules sit at the top so they are unit-testable; the database
 * operations below take the tenant-guarded client and run their own
 * transactions, so the server actions in app/(app)/cases/[id] stay thin
 * wrappers (session, input parsing, revalidation) and the DB suite can call
 * the same code with a forShop() client and no session at all.
 */

export type OfferErrorCode =
  | "caseMissing"
  | "caseDelivered"
  | "jobMissing"
  | "notProposed"
  | "mergeNeedsTwo"
  | "mixedPayers"
  | "priceRequired"
  | "quotationMissing"
  | "nothingToSend"
  | "noDecisions"
  | "invalidInput";

export class OfferError extends Error {
  constructor(readonly code: OfferErrorCode) {
    super(`offer: ${code}`);
    this.name = "OfferError";
  }
}

/** Who is acting — the session's shop and staff, or a script's. */
export type OfferActor = { shopId: string; staffId: string };

/* ------------------------------------------------------------------ */
/* Pure rules.                                                         */
/* ------------------------------------------------------------------ */

/**
 * The freeze point (D-24, amending D-18): a Finding stays editable while its
 * line is Proposed, unpriced and covered by no Quotation line. Once the line
 * is priced or sent it is the stated reason for an amount the payer may be
 * looking at, and the only release is deleting the line.
 */
export function isLineFrozen(job: {
  status: JobStatus;
  priceSatang: number | null;
  quotationLineCount: number;
}): boolean {
  return job.status !== "PROPOSED" || job.priceSatang != null || job.quotationLineCount > 0;
}

/**
 * The derived title of an accepted Finding's line ("Hood — repaint"): the
 * place and the action words, joined the way the rollup joins its words.
 * Shop data from the moment it is written — a retyped title stops following
 * the Finding, judged by comparing it with this derivation (brief, calls
 * made): no extra column.
 */
export function deriveLineTitle(label: string, actionWords: readonly string[]): string {
  const words = actionWords.map(midSentence);
  return words.length > 0 ? `${label} — ${words.join(" + ")}` : label;
}

/** Mid-sentence form: first letter down; Thai has no case and passes through. */
function midSentence(word: string): string {
  return word.charAt(0).toLocaleLowerCase() + word.slice(1);
}

/**
 * The merge price rule (brief, calls made): the merged line keeps a price
 * only if exactly one of its parts had one. Two priced panels are not their
 * sum once they are one repaint — the merged line is re-priced.
 */
export function mergedPrice(prices: readonly (number | null)[]): number | null {
  const priced = prices.filter((price): price is number => price != null);
  return priced.length === 1 ? priced[0]! : null;
}

/** The oldest line survives a merge; ties (same instant) break on id. */
export function mergeSurvivor<T extends { id: string; createdAt: Date }>(jobs: readonly T[]): T {
  return [...jobs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )[0]!;
}

/* ------------------------------------------------------------------ */
/* Findings ↔ lines (D-24).                                            */
/* ------------------------------------------------------------------ */

const LINE_FREEZE_SELECT = {
  id: true,
  title: true,
  status: true,
  priceSatang: true,
  _count: { select: { quotationLines: true } },
} as const;

type LineFreezeRow = {
  id: string;
  title: string;
  status: JobStatus;
  priceSatang: number | null;
  _count: { quotationLines: number };
};

export function lineIsFrozen(job: LineFreezeRow | null): boolean {
  return job != null && isLineFrozen({ ...job, quotationLineCount: job._count.quotationLines });
}

/** The Finding's line with what the freeze check needs, or null while ungrouped. */
export async function findingLine(
  db: TenantDb | FlowTx,
  finding: { jobId: string | null },
): Promise<LineFreezeRow | null> {
  if (!finding.jobId) return null;
  return db.job.findUnique({ where: { id: finding.jobId }, select: LINE_FREEZE_SELECT });
}

/**
 * Accept fills the Offer: the Finding's Proposed line — derived title, payer
 * Customer, unpriced — created in the same transaction as the accept, with
 * its JOB_CREATED event. Returns the new line's id.
 */
export async function createLineForFinding(
  tx: FlowTx,
  actor: OfferActor,
  finding: { id: string; caseId: string },
  title: string,
): Promise<string> {
  const job = await tx.job.create({
    data: {
      shopId: actor.shopId,
      caseId: finding.caseId,
      title,
      payerType: "CUSTOMER",
      createdByStaffId: actor.staffId,
    },
    select: { id: true },
  });
  await tx.finding.update({ where: { id: finding.id }, data: { jobId: job.id } });
  await tx.caseEvent.create({
    data: {
      shopId: actor.shopId,
      caseId: finding.caseId,
      type: "JOB_CREATED",
      jobId: job.id,
      jobTitle: title,
      actorStaffId: actor.staffId,
    },
  });
  return job.id;
}

/**
 * Take a Finding off its (unfrozen) line — when it is discarded, or accepted
 * again proposing no work. A line that then holds nothing at all — no other
 * Finding, no parts, no photos, no note — was the accept's own creation and
 * goes with it (JOB_DELETED); a line someone has since worked on stays,
 * detached, for a human to decide about.
 */
export async function releaseFindingLine(
  tx: FlowTx,
  actor: OfferActor,
  finding: { id: string; caseId: string; jobId: string },
): Promise<void> {
  await tx.finding.update({ where: { id: finding.id }, data: { jobId: null } });
  const job = await tx.job.findUnique({
    where: { id: finding.jobId },
    select: {
      id: true,
      title: true,
      note: true,
      _count: { select: { findings: true, partLines: true, photos: true } },
    },
  });
  if (!job) return;
  const bare =
    job._count.findings === 0 &&
    job._count.partLines === 0 &&
    job._count.photos === 0 &&
    job.note == null;
  if (!bare) return;
  await tx.jobAuthorization.deleteMany({ where: { jobId: job.id } });
  await tx.job.delete({ where: { id: job.id } });
  await tx.caseEvent.create({
    data: {
      shopId: actor.shopId,
      caseId: finding.caseId,
      type: "JOB_DELETED",
      jobTitle: job.title,
      actorStaffId: actor.staffId,
    },
  });
}

/**
 * Delete a still-Proposed line: its Findings REOPEN — jobId cleared and
 * confirmedAt cleared (D-24, amending D-11: deleting the line is the
 * reopen). Part lines, authorization history and photo rows go with it
 * (storage bytes orphan — the M3 trade-off); a quotation line keeps its
 * snapshot with its soft job link set NULL by the database.
 */
export async function deleteProposedLine(
  tx: FlowTx,
  actor: OfferActor,
  job: { id: string; title: string; caseId: string },
): Promise<void> {
  await tx.finding.updateMany({
    where: { jobId: job.id },
    data: { jobId: null, confirmedAt: null },
  });
  await tx.partLine.deleteMany({ where: { jobId: job.id } });
  await tx.jobAuthorization.deleteMany({ where: { jobId: job.id } });
  await tx.photo.deleteMany({ where: { jobId: job.id } });
  await tx.job.delete({ where: { id: job.id } });
  await tx.caseEvent.create({
    data: {
      shopId: actor.shopId,
      caseId: job.caseId,
      type: "JOB_DELETED",
      jobTitle: job.title,
      actorStaffId: actor.staffId,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Merge (D-24).                                                       */
/* ------------------------------------------------------------------ */

/**
 * Join two or more Proposed lines of one payer into one: the oldest
 * survives; Findings, part lines, photos and authorization history move to
 * it; the others are deleted, each recorded as a JOB_MERGED event naming the
 * survivor. The price follows mergedPrice. Returns the survivor's id.
 */
export async function mergeProposedLines(
  db: TenantDb,
  actor: OfferActor,
  caseId: string,
  jobIds: string[],
): Promise<string> {
  const ids = [...new Set(jobIds)];
  if (ids.length < 2) throw new OfferError("mergeNeedsTwo");
  const jobs = await db.job.findMany({
    where: { id: { in: ids }, caseId },
    select: {
      id: true,
      title: true,
      status: true,
      priceSatang: true,
      payerType: true,
      insurerName: true,
      catalogItemId: true,
      createdAt: true,
    },
  });
  if (jobs.length !== ids.length) throw new OfferError("jobMissing");
  if (jobs.some((job) => job.status !== "PROPOSED")) throw new OfferError("notProposed");
  const part = partOf(jobs[0]!);
  if (jobs.some((job) => !samePart(partOf(job), part))) throw new OfferError("mixedPayers");

  const survivor = mergeSurvivor(jobs);
  const absorbed = jobs.filter((job) => job.id !== survivor.id);
  const price = mergedPrice(jobs.map((job) => job.priceSatang));

  await db.$transaction(async (tx) => {
    for (const job of absorbed) {
      await tx.finding.updateMany({ where: { jobId: job.id }, data: { jobId: survivor.id } });
      await tx.partLine.updateMany({ where: { jobId: job.id }, data: { jobId: survivor.id } });
      await tx.photo.updateMany({ where: { jobId: job.id }, data: { jobId: survivor.id } });
      await tx.jobAuthorization.updateMany({
        where: { jobId: job.id },
        data: { jobId: survivor.id },
      });
      await tx.caseEvent.create({
        data: {
          shopId: actor.shopId,
          caseId,
          type: "JOB_MERGED",
          jobId: survivor.id,
          jobTitle: job.title,
          subjectName: survivor.title,
          actorStaffId: actor.staffId,
        },
      });
      await tx.job.delete({ where: { id: job.id } });
    }
    await tx.job.update({
      where: { id: survivor.id },
      data: {
        priceSatang: price,
        // A re-priced line has no override to speak of any more.
        ...(price == null ? { priceOverriddenByStaffId: null } : {}),
      },
    });
  });
  return survivor.id;
}

/* ------------------------------------------------------------------ */
/* The Response (D-20).                                                */
/* ------------------------------------------------------------------ */

export type OfferDecision = { jobId: string; decision: "AUTHORIZED" | "DECLINED" };

export type OfferResponseInput = {
  part: OfferPart;
  channel: string;
  quotationId?: string | null;
  note?: string | null;
  decisions: OfferDecision[];
};

/**
 * Record one payer's answer to the Offer as a set: one JobAuthorization and
 * one JOB_AUTHORIZATION_RECORDED event per decision, in one transaction,
 * with the case's readiness re-derived once. Every decision is checked
 * before anything is written — a Job not Proposed, not this case's, not this
 * payer's, or authorized without a price refuses the whole Response, so one
 * bad decision writes nothing. Returns the decided Job ids.
 */
export async function recordOfferResponse(
  db: TenantDb,
  actor: OfferActor,
  caseId: string,
  input: OfferResponseInput,
): Promise<{ jobIds: string[]; authorizedAny: boolean }> {
  const repairCase = await db.repairCase.findUnique({
    where: { id: caseId },
    select: { id: true, status: true },
  });
  if (!repairCase) throw new OfferError("caseMissing");
  if (repairCase.status === "DELIVERED") throw new OfferError("caseDelivered");
  if (!(AUTH_CHANNELS as readonly string[]).includes(input.channel)) {
    throw new OfferError("invalidInput");
  }
  const channel = input.channel as AuthorizationChannel;

  const decisions = new Map<string, OfferDecision["decision"]>();
  for (const decision of input.decisions) {
    if (decision.decision !== "AUTHORIZED" && decision.decision !== "DECLINED") {
      throw new OfferError("invalidInput");
    }
    decisions.set(decision.jobId, decision.decision);
  }
  if (decisions.size === 0) throw new OfferError("noDecisions");

  const jobs = await db.job.findMany({
    where: { id: { in: [...decisions.keys()] }, caseId },
    select: {
      id: true,
      title: true,
      status: true,
      priceSatang: true,
      payerType: true,
      insurerName: true,
    },
  });
  if (jobs.length !== decisions.size) throw new OfferError("jobMissing");
  for (const job of jobs) {
    if (job.status !== "PROPOSED") throw new OfferError("notProposed");
    if (!samePart(partOf(job), input.part)) throw new OfferError("invalidInput");
    // The payer authorizes an amount — an unpriced line can be declined ("no
    // thanks" to a suggestion) but never authorized.
    if (decisions.get(job.id) === "AUTHORIZED" && job.priceSatang == null) {
      throw new OfferError("priceRequired");
    }
  }

  let quotationId: string | null = null;
  if (input.quotationId) {
    const quotation = await db.quotation.findUnique({
      where: { id: input.quotationId },
      select: { id: true, caseId: true },
    });
    if (!quotation || quotation.caseId !== caseId) throw new OfferError("quotationMissing");
    quotationId = quotation.id;
  }
  const note = String(input.note ?? "").trim().slice(0, 2000) || null;
  const authorizedAny = [...decisions.values()].includes("AUTHORIZED");

  await db.$transaction(async (tx) => {
    for (const job of jobs) {
      const decision = decisions.get(job.id)!;
      await tx.jobAuthorization.create({
        data: {
          shopId: actor.shopId,
          jobId: job.id,
          decision,
          channel,
          quotationId,
          note,
          recordedByStaffId: actor.staffId,
        },
      });
      await tx.job.update({ where: { id: job.id }, data: { status: decision } });
      await tx.caseEvent.create({
        data: {
          shopId: actor.shopId,
          caseId,
          type: "JOB_AUTHORIZATION_RECORDED",
          jobId: job.id,
          jobTitle: job.title,
          fromStatus: "PROPOSED",
          toStatus: decision,
          note,
          actorStaffId: actor.staffId,
        },
      });
    }
    // New authorized work on a READY case revokes it (M5 ruling 4a) — once
    // for the whole Response, not once per line.
    if (authorizedAny) await applyCaseReadiness(tx, actor.shopId, caseId, actor.staffId);
  });

  return { jobIds: jobs.map((job) => job.id), authorizedAny };
}

/* ------------------------------------------------------------------ */
/* Send quotation stamps the version (D-25).                           */
/* ------------------------------------------------------------------ */

/**
 * The part's Quotation for what is on offer right now: the latest version
 * whose lines equal the part's priced Proposed lines at current prices, else
 * a new version snapshotted through the M4 issue path (QUOTATION_ISSUED).
 * Nobody issues a version by hand any more — sending is what stamps it.
 * Unpriced lines are left behind (the dialog warns); an Offer with nothing
 * priced has nothing to send.
 */
export async function stampQuotation(
  db: TenantDb,
  actor: OfferActor,
  caseId: string,
  part: OfferPart,
): Promise<{ quotationId: string; created: boolean }> {
  const repairCase = await db.repairCase.findUnique({
    where: { id: caseId },
    select: { id: true, status: true, reference: true },
  });
  if (!repairCase) throw new OfferError("caseMissing");
  if (repairCase.status === "DELIVERED") throw new OfferError("caseDelivered");

  const jobs = await db.job.findMany({
    where: { caseId, status: "PROPOSED" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      priceSatang: true,
      payerType: true,
      insurerName: true,
    },
  });
  const lines = pricedOfferLines(jobs, part);
  if (lines.length === 0) throw new OfferError("nothingToSend");

  const quotations = await db.quotation.findMany({
    where: { caseId },
    orderBy: { version: "desc" },
    select: { id: true, lines: { select: { jobId: true, priceSatang: true } } },
  });
  const covering = coveringQuotation(quotations, lines);
  if (covering) return { quotationId: covering.id, created: false };

  const created = await db.$transaction(async (tx) => {
    const latest = await tx.quotation.aggregate({ where: { caseId }, _max: { version: true } });
    const quotation = await tx.quotation.create({
      data: {
        shopId: actor.shopId,
        caseId,
        number: quotationNumberFor(repairCase.reference),
        version: (latest._max.version ?? 0) + 1,
        totalSatang: lines.reduce((sum, job) => sum + job.priceSatang!, 0),
        issuedByStaffId: actor.staffId,
      },
      select: { id: true },
    });
    await tx.quotationLine.createMany({
      data: lines.map((job, index) => ({
        shopId: actor.shopId,
        quotationId: quotation.id,
        jobId: job.id,
        title: job.title,
        priceSatang: job.priceSatang!,
        payerType: job.payerType,
        insurerName: job.payerType === "INSURER" ? job.insurerName : null,
        sortOrder: index,
      })),
    });
    await tx.caseEvent.create({
      data: {
        shopId: actor.shopId,
        caseId,
        type: "QUOTATION_ISSUED",
        quotationId: quotation.id,
        actorStaffId: actor.staffId,
      },
    });
    return quotation;
  });
  return { quotationId: created.id, created: true };
}

/** What a Finding proposes, for the title derivation callers. */
export type DerivableFinding = {
  zone: string | null;
  checklistItem: string | null;
  proposedActions: readonly ProposedAction[];
};
