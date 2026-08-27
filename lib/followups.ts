import type { FindingCondition, FindingSource, JobStatus } from "@/lib/generated/prisma/enums";
import type { FlowTx } from "@/lib/case-flow";

/**
 * Follow-up minting (M7 brief, decision 4 — ruled by the founder): stored
 * worklist rows, minted inside the Mark-delivered transaction. Delivery
 * freezes the work record (the M3/M4/M5 guards), so the candidate set is
 * final at the only moment that matters and rows can never drift from their
 * sources. Nothing is minted before delivery — a declined Job can still be
 * re-quoted and authorized mid-visit.
 *
 * Candidates (CONTEXT.md's two sources):
 * - every DECLINED Job, with its title + quoted price snapshotted;
 * - every wear Finding (checklist, condition set) that never became
 *   authorized work — ungrouped, or grouped into a Job that is still
 *   PROPOSED at delivery (the customer never answered). A Finding on a
 *   DECLINED Job is covered by that Job's row, never double-minted; one on
 *   an authorized/completed Job was actioned; one on a CANCELLED Job DID
 *   become authorized work and is deliberately excluded (founder ruling —
 *   noted for the pilot, since the stopped work's wear item arguably still
 *   needs chasing).
 */

export type FollowUpCandidateJob = {
  id: string;
  status: JobStatus;
  title: string;
  priceSatang: number | null;
};

export type FollowUpCandidateFinding = {
  id: string;
  source: FindingSource;
  checklistItem: string | null;
  condition: FindingCondition | null;
  /** The status of the Job fulfilling it, or null when ungrouped. */
  jobStatus: JobStatus | null;
};

export type FollowUpCandidate =
  | { jobId: string; jobTitle: string; quotedPriceSatang: number | null }
  | { findingId: string; checklistItem: string; condition: FindingCondition };

/** Pure: the rows the delivery mint creates. Unit-tested in isolation. */
export function followUpCandidates(
  jobs: readonly FollowUpCandidateJob[],
  findings: readonly FollowUpCandidateFinding[],
): FollowUpCandidate[] {
  const candidates: FollowUpCandidate[] = [];
  for (const job of jobs) {
    if (job.status === "DECLINED") {
      candidates.push({ jobId: job.id, jobTitle: job.title, quotedPriceSatang: job.priceSatang });
    }
  }
  for (const finding of findings) {
    if (finding.source !== "CHECKLIST") continue;
    if (finding.checklistItem == null || finding.condition == null) continue;
    if (finding.jobStatus !== null && finding.jobStatus !== "PROPOSED") continue;
    candidates.push({
      findingId: finding.id,
      checklistItem: finding.checklistItem,
      condition: finding.condition,
    });
  }
  return candidates;
}

/**
 * Mint this case's FollowUps — called inside the Mark-delivered transaction,
 * and by the pre-M7 backfill (scripts/followups-backfill.ts). Idempotent by
 * construction: one row per source (@@unique per source column) +
 * skipDuplicates. Returns how many rows were created.
 */
export async function mintFollowUpsForCase(
  tx: FlowTx,
  shopId: string,
  caseId: string,
  contactCustomerId: string,
): Promise<number> {
  const [jobs, findings] = await Promise.all([
    tx.job.findMany({
      where: { caseId },
      select: { id: true, status: true, title: true, priceSatang: true },
    }),
    tx.finding.findMany({
      where: { caseId },
      select: {
        id: true,
        source: true,
        checklistItem: true,
        condition: true,
        job: { select: { status: true } },
      },
    }),
  ]);

  const candidates = followUpCandidates(
    jobs,
    findings.map((finding) => ({
      id: finding.id,
      source: finding.source,
      checklistItem: finding.checklistItem,
      condition: finding.condition,
      jobStatus: finding.job?.status ?? null,
    })),
  );
  if (candidates.length === 0) return 0;

  const result = await tx.followUp.createMany({
    data: candidates.map((candidate) => ({
      shopId,
      caseId,
      customerId: contactCustomerId,
      ...candidate,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
