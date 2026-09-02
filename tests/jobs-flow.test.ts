import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import { prismaUnscoped } from "@/lib/db";
import { resolvePublishedQuotation } from "@/lib/line-public";
import enMessages from "@/messages/en.json";

/**
 * The Jobs flow against a real database (M7.7 brief §11): the actions
 * themselves, run with a stand-in session — accept creates the line, the
 * freeze point, delete-reopens, the merge price rule, the Response's
 * atomicity, Send quotation's version reuse, and the public route's
 * resolver. Everything the actions touch that only exists inside a Next
 * request (the session, revalidation, the request locale) is mocked at the
 * seam; the tenant guard and the transactions are real.
 */

const current = vi.hoisted(() => ({
  session: { userId: "", shopId: "", staffId: "", role: "MANAGER" as "MANAGER" | "ADVISOR", name: "", email: "" },
}));

vi.mock("@/lib/session", async () => {
  const { forShop } = await import("@/lib/tenant");
  return {
    requireSession: async () => current.session,
    tenantDb: async () => forShop(current.session.shopId),
    tenantContext: async () => ({ session: current.session, db: forShop(current.session.shopId) }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "en", messages: enMessages, namespace: namespace as never }),
    getLocale: async () => "en",
    getFormatter: async () => ({ dateTime: (d: Date) => d.toISOString() }),
  };
});

const { setFindingConfirmed, updateFinding, removeFinding } = await import(
  "@/app/(app)/cases/[id]/inspection/actions"
);
const { deleteJob, mergeJobs, recordOfferResponse, updateJobPrice, createCustomJob } = await import(
  "@/app/(app)/cases/[id]/job-actions"
);
const { sendQuotation } = await import("@/app/(app)/cases/[id]/quotation-actions");

const run = `jf-${Date.now()}`;
let shopId: string;
let staffId: string;
let customerId: string;
let vehicleId: string;
const caseIds: string[] = [];

const ti = createTranslator({ locale: "en", messages: enMessages, namespace: "inspection" });

async function newCase(): Promise<string> {
  const repairCase = await prismaUnscoped.repairCase.create({
    data: {
      shopId,
      reference: `${run}-RC-${caseIds.length + 1}`,
      vehicleId,
      contactCustomerId: customerId,
      openedByStaffId: staffId,
    },
  });
  caseIds.push(repairCase.id);
  return repairCase.id;
}

async function mapFinding(caseId: string, zone: string, actions: ("REPAIR" | "REPAINT" | "REPLACE")[]) {
  return prismaUnscoped.finding.create({
    data: {
      shopId,
      caseId,
      source: "DAMAGE_MAP",
      zone,
      damageTypes: ["DENT"],
      proposedActions: actions,
      recordedByStaffId: staffId,
    },
  });
}

beforeAll(async () => {
  const shop = await prismaUnscoped.shop.create({ data: { name: `${run} Shop` } });
  shopId = shop.id;
  const staff = await prismaUnscoped.staff.create({
    data: { shopId, name: `${run} Advisor`, position: "advisor" },
  });
  staffId = staff.id;
  const customer = await prismaUnscoped.customer.create({
    data: { shopId, name: `${run} Customer`, phone: "0810000077" },
  });
  customerId = customer.id;
  const vehicle = await prismaUnscoped.vehicle.create({
    data: { shopId, plate: `${run}ข9`, bodyType: "SEDAN", primaryCustomerId: customerId },
  });
  vehicleId = vehicle.id;
  current.session = { userId: "u", shopId, staffId, role: "MANAGER", name: "", email: "" };
});

afterAll(async () => {
  await prismaUnscoped.caseEvent.deleteMany({ where: { shopId } });
  await prismaUnscoped.lineUpdate.deleteMany({ where: { shopId } });
  await prismaUnscoped.jobAuthorization.deleteMany({ where: { shopId } });
  await prismaUnscoped.quotationLine.deleteMany({ where: { shopId } });
  await prismaUnscoped.quotation.deleteMany({ where: { shopId } });
  await prismaUnscoped.partLine.deleteMany({ where: { shopId } });
  await prismaUnscoped.photo.deleteMany({ where: { shopId } });
  await prismaUnscoped.finding.deleteMany({ where: { shopId } });
  await prismaUnscoped.job.deleteMany({ where: { shopId } });
  await prismaUnscoped.repairCase.deleteMany({ where: { shopId } });
  await prismaUnscoped.vehicle.deleteMany({ where: { shopId } });
  await prismaUnscoped.customer.deleteMany({ where: { shopId } });
  await prismaUnscoped.staff.deleteMany({ where: { shopId } });
  await prismaUnscoped.shop.delete({ where: { id: shopId } });
});

describe("accept fills the Offer (D-24)", () => {
  it("creates the Proposed line — derived title, payer Customer, unpriced — with its event", async () => {
    const caseId = await newCase();
    const finding = await mapFinding(caseId, "hood", ["REPAINT"]);

    const res = await setFindingConfirmed(finding.id, true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.jobId).not.toBeNull();
    expect(res.value.frozen).toBe(false);

    const job = await prismaUnscoped.job.findUniqueOrThrow({ where: { id: res.value.jobId! } });
    expect(job.title).toBe(`${ti("zones.hood")} — repaint`);
    expect(job.status).toBe("PROPOSED");
    expect(job.payerType).toBe("CUSTOMER");
    expect(job.priceSatang).toBeNull();
    const events = await prismaUnscoped.caseEvent.findMany({ where: { caseId, type: "JOB_CREATED" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.jobId).toBe(job.id);
  });

  it("creates nothing for a due-soon wear item proposing no work", async () => {
    const caseId = await newCase();
    const finding = await prismaUnscoped.finding.create({
      data: {
        shopId,
        caseId,
        source: "CHECKLIST",
        checklistItem: "battery",
        condition: "DUE_SOON",
        proposedActions: [],
        recordedByStaffId: staffId,
      },
    });
    const res = await setFindingConfirmed(finding.id, true);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.jobId).toBeNull();
    expect(await prismaUnscoped.job.count({ where: { caseId } })).toBe(0);
  });

  it("lets the derived title follow an edit until someone retypes it", async () => {
    const caseId = await newCase();
    const finding = await mapFinding(caseId, "door-fl", ["REPAIR"]);
    const accepted = await setFindingConfirmed(finding.id, true);
    if (!accepted.ok) throw new Error(accepted.error);
    const jobId = accepted.value.jobId!;

    // Reopen, add repaint: the title follows.
    await setFindingConfirmed(finding.id, false);
    await updateFinding(finding.id, { proposedActions: ["REPAIR", "REPAINT"] });
    let job = await prismaUnscoped.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.title).toBe(`${ti("zones.door-fl")} — repair + repaint`);

    // Retyped by a human: it stops following.
    await prismaUnscoped.job.update({ where: { id: jobId }, data: { title: "Left-side repaint" } });
    await updateFinding(finding.id, { proposedActions: ["REPAINT"] });
    job = await prismaUnscoped.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.title).toBe("Left-side repaint");
  });
});

describe("the freeze point (D-24, amending D-18)", () => {
  it("allows reopen and edit while the line is unpriced, refuses once priced, and delete reopens", async () => {
    const caseId = await newCase();
    const finding = await mapFinding(caseId, "hood", ["REPAINT"]);
    const accepted = await setFindingConfirmed(finding.id, true);
    if (!accepted.ok) throw new Error(accepted.error);
    const jobId = accepted.value.jobId!;

    // Unpriced: reopening is allowed and the line stays.
    const reopened = await setFindingConfirmed(finding.id, false);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.value.jobId).toBe(jobId);
    const reaccepted = await setFindingConfirmed(finding.id, true);
    expect(reaccepted.ok).toBe(true);

    // Priced: frozen on every path.
    const priced = await updateJobPrice(jobId, "4500");
    expect(priced.ok).toBe(true);
    const edit = await updateFinding(finding.id, { note: "later" });
    expect(edit).toEqual({ ok: false, error: "findingFrozen" });
    const reopen = await setFindingConfirmed(finding.id, false);
    expect(reopen).toEqual({ ok: false, error: "findingFrozen" });
    const remove = await removeFinding(finding.id);
    expect(remove).toEqual({ ok: false, error: "findingFrozen" });
    const frozenRow = await prismaUnscoped.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(frozenRow.confirmedAt).not.toBeNull();

    // Deleting the line is the release: the Finding reopens.
    const deleted = await deleteJob(jobId);
    expect(deleted.ok).toBe(true);
    const row = await prismaUnscoped.finding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(row.jobId).toBeNull();
    expect(row.confirmedAt).toBeNull();
  });

  it("discarding a Finding takes its bare line with it", async () => {
    const caseId = await newCase();
    const finding = await mapFinding(caseId, "roof", ["REPAINT"]);
    const accepted = await setFindingConfirmed(finding.id, true);
    if (!accepted.ok) throw new Error(accepted.error);
    const removed = await removeFinding(finding.id);
    expect(removed.ok).toBe(true);
    expect(await prismaUnscoped.job.count({ where: { id: accepted.value.jobId! } })).toBe(0);
    const events = await prismaUnscoped.caseEvent.findMany({ where: { caseId, type: "JOB_DELETED" } });
    expect(events).toHaveLength(1);
  });
});

describe("merge (D-24)", () => {
  async function twoLines(caseId: string) {
    const a = await mapFinding(caseId, "door-fl", ["REPAINT"]);
    const b = await mapFinding(caseId, "door-rl", ["REPAINT"]);
    const ra = await setFindingConfirmed(a.id, true);
    const rb = await setFindingConfirmed(b.id, true);
    if (!ra.ok || !rb.ok) throw new Error("accept failed");
    return { a, b, jobA: ra.value.jobId!, jobB: rb.value.jobId! };
  }

  it("keeps the price only if exactly one part had one, moves the Findings, and records JOB_MERGED", async () => {
    const caseId = await newCase();
    const { a, b, jobA, jobB } = await twoLines(caseId);
    await updateJobPrice(jobB, "12000");

    const res = await mergeJobs(caseId, [jobB, jobA]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The oldest survives — jobA was created first.
    expect(res.value.survivor.id).toBe(jobA);
    expect(res.value.survivor.priceSatang).toBe(1_200_000);
    expect(res.value.absorbedIds).toEqual([jobB]);
    expect(await prismaUnscoped.job.count({ where: { id: jobB } })).toBe(0);
    const findings = await prismaUnscoped.finding.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(findings.every((f) => f.jobId === jobA)).toBe(true);
    const merged = await prismaUnscoped.caseEvent.findMany({ where: { caseId, type: "JOB_MERGED" } });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.jobId).toBe(jobA);
    expect(merged[0]!.subjectName).toBe(res.value.survivor.title);
  });

  it("re-prices when both parts were priced", async () => {
    const caseId = await newCase();
    const { jobA, jobB } = await twoLines(caseId);
    await updateJobPrice(jobA, "5000");
    await updateJobPrice(jobB, "7000");
    const res = await mergeJobs(caseId, [jobA, jobB]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.survivor.priceSatang).toBeNull();
  });

  it("refuses one line, a foreign line, and mixed payers", async () => {
    const caseId = await newCase();
    const { jobA, jobB } = await twoLines(caseId);
    expect(await mergeJobs(caseId, [jobA])).toEqual({ ok: false, error: "mergeNeedsTwo" });
    const other = await newCase();
    const foreign = await createCustomJob(other, { title: "x", price: "", payerType: "CUSTOMER" });
    if (!foreign.ok) throw new Error(foreign.error);
    expect(await mergeJobs(caseId, [jobA, foreign.value.id])).toEqual({ ok: false, error: "jobMissing" });
    await prismaUnscoped.job.update({
      where: { id: jobB },
      data: { payerType: "INSURER", insurerName: "Viriyah" },
    });
    expect(await mergeJobs(caseId, [jobA, jobB])).toEqual({ ok: false, error: "mixedPayers" });
  });
});

describe("the Response as a set (D-20)", () => {
  it("writes one authorization and one event per decision, in one save", async () => {
    const caseId = await newCase();
    const a = await createCustomJob(caseId, { title: "A", price: "1000", payerType: "CUSTOMER" });
    const b = await createCustomJob(caseId, { title: "B", price: "2000", payerType: "CUSTOMER" });
    const c = await createCustomJob(caseId, { title: "C", price: "", payerType: "CUSTOMER" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("create failed");

    const res = await recordOfferResponse(caseId, {
      payerType: "CUSTOMER",
      channel: "LINE",
      note: "ok",
      decisions: [
        { jobId: a.value.id, decision: "AUTHORIZED" },
        { jobId: b.value.id, decision: "AUTHORIZED" },
        { jobId: c.value.id, decision: "DECLINED" },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((job) => job.status).sort()).toEqual(["AUTHORIZED", "AUTHORIZED", "DECLINED"]);
    const auths = await prismaUnscoped.jobAuthorization.findMany({
      where: { jobId: { in: [a.value.id, b.value.id, c.value.id] } },
    });
    expect(auths).toHaveLength(3);
    expect(auths.every((auth) => auth.channel === "LINE" && auth.note === "ok")).toBe(true);
    const events = await prismaUnscoped.caseEvent.count({
      where: { caseId, type: "JOB_AUTHORIZATION_RECORDED" },
    });
    expect(events).toBe(3);
  });

  it("writes nothing when one decision is bad — an unpriced line cannot be authorized", async () => {
    const caseId = await newCase();
    const a = await createCustomJob(caseId, { title: "A", price: "1000", payerType: "CUSTOMER" });
    const c = await createCustomJob(caseId, { title: "C", price: "", payerType: "CUSTOMER" });
    if (!a.ok || !c.ok) throw new Error("create failed");

    const res = await recordOfferResponse(caseId, {
      payerType: "CUSTOMER",
      channel: "PHONE",
      decisions: [
        { jobId: a.value.id, decision: "AUTHORIZED" },
        { jobId: c.value.id, decision: "AUTHORIZED" },
      ],
    });
    expect(res).toEqual({ ok: false, error: "priceRequired" });
    const jobs = await prismaUnscoped.job.findMany({ where: { caseId } });
    expect(jobs.every((job) => job.status === "PROPOSED")).toBe(true);
    expect(await prismaUnscoped.jobAuthorization.count({ where: { jobId: { in: jobs.map((j) => j.id) } } })).toBe(0);
  });

  it("refuses another payer's line and a foreign quotation", async () => {
    const caseId = await newCase();
    const a = await createCustomJob(caseId, { title: "A", price: "1000", payerType: "INSURER", insurerName: "Viriyah" });
    if (!a.ok) throw new Error(a.error);
    expect(
      await recordOfferResponse(caseId, {
        payerType: "CUSTOMER",
        channel: "PHONE",
        decisions: [{ jobId: a.value.id, decision: "AUTHORIZED" }],
      }),
    ).toEqual({ ok: false, error: "invalidInput" });
    expect(
      await recordOfferResponse(caseId, {
        payerType: "INSURER",
        insurerName: "Viriyah",
        channel: "PHONE",
        quotationId: "nope",
        decisions: [{ jobId: a.value.id, decision: "AUTHORIZED" }],
      }),
    ).toEqual({ ok: false, error: "quotationMissing" });
  });
});

describe("Send quotation stamps the version (D-25)", () => {
  it("reuses the version that covers the offer, and stamps a new one when a price moves", async () => {
    const caseId = await newCase();
    const a = await createCustomJob(caseId, { title: "A", price: "1000", payerType: "CUSTOMER" });
    const b = await createCustomJob(caseId, { title: "B", price: "", payerType: "CUSTOMER" });
    if (!a.ok || !b.ok) throw new Error("create failed");

    const first = await sendQuotation(caseId, { payerType: "CUSTOMER", via: "PRINT" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.quotation.version).toBe(1);
    expect(first.value.quotation.lines.map((line) => line.jobId)).toEqual([a.value.id]);
    expect(first.value.update).toBeNull();

    // Unchanged: the same version again, no new issue event.
    const again = await sendQuotation(caseId, { payerType: "CUSTOMER", via: "PRINT" });
    expect(again.ok && again.value.quotation.id).toBe(first.value.quotation.id);
    expect(await prismaUnscoped.caseEvent.count({ where: { caseId, type: "QUOTATION_ISSUED" } })).toBe(1);

    // A price moved: v2.
    await updateJobPrice(a.value.id, "1500");
    const second = await sendQuotation(caseId, { payerType: "CUSTOMER", via: "PRINT" });
    expect(second.ok && second.value.quotation.version).toBe(2);

    // Pricing the other line: v3 covers both; v2 stays.
    await updateJobPrice(b.value.id, "200");
    const third = await sendQuotation(caseId, { payerType: "CUSTOMER", via: "PRINT" });
    expect(third.ok && third.value.quotation.lines).toHaveLength(2);
    expect(await prismaUnscoped.quotation.count({ where: { caseId } })).toBe(3);
  });

  it("has nothing to send while no line is priced, and never pushes to an insurer", async () => {
    const caseId = await newCase();
    const c = await createCustomJob(caseId, { title: "C", price: "", payerType: "CUSTOMER" });
    if (!c.ok) throw new Error(c.error);
    expect(await sendQuotation(caseId, { payerType: "CUSTOMER", via: "PRINT" })).toEqual({
      ok: false,
      error: "nothingToSend",
    });
    expect(await sendQuotation(caseId, { payerType: "INSURER", insurerName: "Viriyah", via: "LINE" })).toEqual({
      ok: false,
      error: "insurerPrintOnly",
    });
  });

  it("a sent version's line freezes its Finding even while unpriced no more", async () => {
    const caseId = await newCase();
    const finding = await mapFinding(caseId, "hood", ["REPAINT"]);
    const accepted = await setFindingConfirmed(finding.id, true);
    if (!accepted.ok) throw new Error(accepted.error);
    await updateJobPrice(accepted.value.jobId!, "3000");
    const sent = await sendQuotation(caseId, { payerType: "CUSTOMER", via: "PRINT" });
    expect(sent.ok).toBe(true);
    // Price cleared again: the quotation line still holds it frozen.
    await prismaUnscoped.job.update({ where: { id: accepted.value.jobId! }, data: { priceSatang: null } });
    expect(await updateFinding(finding.id, { note: "x" })).toEqual({ ok: false, error: "findingFrozen" });
  });
});

describe("the published quotation (D-25): the token is the whole authorization", () => {
  it("resolves a token to its document and an unknown token to nothing", async () => {
    const caseId = await newCase();
    const a = await createCustomJob(caseId, { title: "A", price: "1000", payerType: "CUSTOMER" });
    if (!a.ok) throw new Error(a.error);
    const stamped = await sendQuotation(caseId, { payerType: "CUSTOMER", via: "PRINT" });
    if (!stamped.ok) throw new Error(stamped.error);
    // Printing mints no token — only a send does.
    expect(stamped.value.quotation.publicToken).toBeNull();
    expect(await resolvePublishedQuotation("0123456789abcdef0123456789abcdef")).toBeNull();
    expect(await resolvePublishedQuotation("not-a-token")).toBeNull();

    const token = `${run}`.replace(/[^0-9a-f]/g, "0").padEnd(32, "a").slice(0, 32);
    await prismaUnscoped.quotation.update({
      where: { id: stamped.value.quotation.id },
      data: { publicToken: token },
    });
    const published = await resolvePublishedQuotation(token);
    expect(published?.id).toBe(stamped.value.quotation.id);
    expect(published?.repairCase.contactCustomer.name).toBe(`${run} Customer`);
    expect(published?.lines).toHaveLength(1);
  });
});
