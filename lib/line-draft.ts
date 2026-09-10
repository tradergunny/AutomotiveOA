import type {
  FindingCondition,
  JobStatus,
  LineUpdateKind,
  WaitingReason,
} from "@/lib/generated/prisma/enums";
import { formatBaht } from "@/lib/money";

/**
 * Customer-facing LINE wording. M6 built the pre-filled draft (ADR-003: "the
 * system may pre-fill a draft — a human presses send"); M7.10 (ADR-007)
 * adds one fixed builder per system-sent kind — the Milestone messages and
 * Progress notices of CONTEXT.md — whose words are the system's, plus one
 * optional note as the only human text.
 *
 * Every string here is THAI, deliberately, and is NOT i18n copy: it is
 * customer-facing text like the quotation document (DESIGN.md), so it stays
 * Thai whatever locale the staff member is using. Staff may rewrite any of
 * it before sending — this is a starting point, not a template engine.
 *
 * The status wording is the curated half of CONTEXT.md's two-narrative rule:
 * internal states become calm, customer-safe sentences. "QC" is "final
 * quality check", never "QC failed" — the internal timeline keeps that.
 */

/** Customer-safe wording per Job status. Statuses absent here never appear. */
export const NOTE_MAX_LENGTH = 300;

const CUSTOMER_STATUS_TH: Partial<Record<JobStatus, string>> = {
  PROPOSED: "รอการอนุมัติจากท่าน",
  AUTHORIZED: "รอเริ่มงาน",
  IN_PROGRESS: "กำลังดำเนินการ",
  QC: "ตรวจสอบคุณภาพขั้นสุดท้าย",
  COMPLETED: "เสร็จเรียบร้อย",
};

const WAITING_TH: Record<WaitingReason, string> = {
  PARTS: "รออะไหล่",
  PAINT_BOOTH: "รอเข้าห้องพ่นสี",
  TECHNICIAN: "รอช่างว่าง",
  OTHER: "รอดำเนินการ",
};

export type DraftJob = {
  title: string;
  status: JobStatus;
  waitingReason: WaitingReason | null;
};

export function customerStatusTh(job: DraftJob): string | null {
  if (job.status === "WAITING") return WAITING_TH[job.waitingReason ?? "OTHER"];
  return CUSTOMER_STATUS_TH[job.status] ?? null;
}

/**
 * One line per Job a customer may hear about, or the in-assessment line when
 * none has taken shape yet. Declined and Cancelled Jobs are left out — they
 * are not work in progress, and a status update is not the place to
 * relitigate them. Shared by the draft and the catch-up (M7.10).
 */
function statusLinesTh(jobs: DraftJob[]): string[] {
  const shown = jobs
    .map((job) => ({ job, status: customerStatusTh(job) }))
    .filter((row): row is { job: DraftJob; status: string } => row.status !== null);
  if (shown.length === 0) return ["· อยู่ระหว่างตรวจสอบสภาพรถ"];
  return shown.map(({ job, status }) => `· ${job.title} — ${status}`);
}

/**
 * Build the draft body. Declined and Cancelled Jobs are left out — they are
 * not work in progress, and a status update is not the place to relitigate
 * them.
 */
export function buildDraftBody(input: {
  shopName: string;
  reference: string;
  plate: string;
  customerName: string;
  jobs: DraftJob[];
  caseStatus: "CHECKED_IN" | "READY" | "DELIVERED";
}): string {
  const lines: string[] = [];
  lines.push(`สวัสดีค่ะ คุณ${input.customerName}`);
  lines.push(`อัปเดตงานซ่อมรถทะเบียน ${input.plate} (${input.reference})`);
  lines.push("");

  lines.push(...statusLinesTh(input.jobs));

  if (input.caseStatus === "READY") {
    lines.push("");
    lines.push("รถพร้อมให้เข้ามารับได้แล้วค่ะ");
  }
  if (input.caseStatus === "DELIVERED") {
    lines.push("");
    lines.push("ขอบคุณที่ไว้วางใจให้ดูแลรถนะคะ");
  }

  lines.push("");
  lines.push(`${input.shopName}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* The quotation message (M7.7 brief §6, D-25).                        */
/* ------------------------------------------------------------------ */

export type QuotationBodyLine = { title: string; priceSatang: number };

/**
 * What Send quotation pushes: a greeting, the document number, one line per
 * Job with its price, the total, the unguessable document link, and the
 * shop's name. Thai-first data like every other message here — the
 * customer opens a real numbered document inside LINE (D-25), so the text
 * is a summary that points at it, not the document itself. Rich (Flex)
 * messages stay in LATER.md; this is the MVP text-plus-link.
 */
export function buildQuotationBody(input: {
  shopName: string;
  customerName: string;
  plate: string;
  reference: string;
  label: string;
  lines: QuotationBodyLine[];
  totalSatang: number;
  documentUrl: string;
}): string {
  const lines: string[] = [];
  lines.push(`สวัสดีค่ะ คุณ${input.customerName}`);
  lines.push(`ใบเสนอราคา ${input.label} สำหรับรถทะเบียน ${input.plate} (${input.reference})`);
  lines.push("");
  for (const line of input.lines) {
    lines.push(`· ${line.title} — ${formatBaht(line.priceSatang)}`);
  }
  lines.push(`รวม ${formatBaht(input.totalSatang)}`);
  lines.push("");
  lines.push("เปิดดูใบเสนอราคาฉบับเต็มได้ที่");
  lines.push(input.documentUrl);
  lines.push("");
  lines.push("หากตกลงหรือมีข้อสงสัย ตอบกลับได้เลยนะคะ");
  lines.push("");
  lines.push(`${input.shopName}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Follow-up drafts (M7 brief §6, decision 5).                         */
/* ------------------------------------------------------------------ */

/**
 * Customer-facing Thai names for checklist items — NOT the staff i18n copy
 * (messages/*.json): this is message data, like everything else in this
 * module, so it stays Thai in both staff locales and staff may rewrite it.
 */
const CHECKLIST_TH: Record<string, string> = {
  "engine-oil": "เครื่องยนต์ / น้ำมันเครื่อง",
  transmission: "ระบบเกียร์",
  brakes: "ระบบเบรก / ผ้าเบรก",
  "tires-suspension": "ยางและช่วงล่าง",
  battery: "แบตเตอรี่",
  lights: "ไฟส่องสว่าง",
  aircon: "ระบบแอร์",
  fluids: "ของเหลว (น้ำยาหล่อเย็น · น้ำมันเบรก · น้ำฉีดกระจก)",
};

/** Calm wear phrasing — a nudge, never an alarm. */
const CONDITION_TH: Record<FindingCondition, string> = {
  DUE_SOON: "ใกล้ถึงกำหนดที่ควรดูแล",
  NEEDS_WORK: "ควรได้รับการตรวจซ่อม",
};

export type FollowUpDraftSource =
  | { kind: "job"; title: string; quotedPriceSatang: number | null }
  | { kind: "finding"; checklistItem: string; condition: FindingCondition | null };

/**
 * The pre-filled chase message (ADR-003 unchanged: a human reads, edits, and
 * presses send). References the declined work and its quoted price, or the
 * wear item — "your windshield from the March visit, the quote still
 * stands" — in customer-safe wording.
 */
export function buildFollowUpDraftBody(input: {
  shopName: string;
  customerName: string;
  plate: string;
  source: FollowUpDraftSource;
}): string {
  const lines: string[] = [];
  lines.push(`สวัสดีค่ะ คุณ${input.customerName}`);
  lines.push(`ทางอู่ขออนุญาตติดตามเรื่องรถทะเบียน ${input.plate} ค่ะ`);
  lines.push("");

  if (input.source.kind === "job") {
    const price =
      input.source.quotedPriceSatang != null
        ? ` (ราคาที่เคยเสนอไว้ ${formatBaht(input.source.quotedPriceSatang)})`
        : "";
    lines.push(`จากการเข้ารับบริการครั้งที่แล้ว ยังมีรายการ "${input.source.title}" ที่ยังไม่ได้ดำเนินการ${price}`);
  } else {
    const item = CHECKLIST_TH[input.source.checklistItem] ?? input.source.checklistItem;
    const condition = CONDITION_TH[input.source.condition ?? "DUE_SOON"];
    lines.push(`จากการตรวจสภาพครั้งที่แล้ว พบว่า ${item} ${condition}ค่ะ`);
  }

  lines.push("");
  lines.push("หากสนใจให้ทางอู่ดูแลต่อ หรือต้องการสอบถามเพิ่มเติม ติดต่อกลับได้เลยนะคะ");
  lines.push("");
  lines.push(`${input.shopName}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* System-sent kinds (M7.10, ADR-007): one fixed builder per kind.     */
/* ------------------------------------------------------------------ */

/**
 * The facts every system message opens with. `note` is the one optional
 * human paragraph a Milestone act may add ("we washed it for you"): trimmed,
 * capped at NOTE_MAX_LENGTH, appended as written, last before the signature.
 */
export type SystemBodyBase = {
  shopName: string;
  customerName: string;
  plate: string;
  reference: string;
  note?: string | null;
};

/** The note as it will be sent, or null when there is nothing to send. */
export function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, NOTE_MAX_LENGTH);
}

/**
 * A date-only value (Part Line ETA, a @db.Date) in Thai — Buddhist year,
 * long month — read in UTC so the stored day is the day shown.
 */
export function formatThaiDate(date: Date): string {
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Greeting, car line, blank — then the kind's own paragraphs, note, signature. */
function systemBody(base: SystemBodyBase, carLine: string, paragraphs: string[][]): string {
  const blocks: string[][] = [[`สวัสดีค่ะ คุณ${base.customerName}`, carLine], ...paragraphs];
  const note = normalizeNote(base.note);
  if (note) blocks.push([note]);
  blocks.push([base.shopName]);
  return blocks.map((block) => block.join("\n")).join("\n\n");
}

const carLine = (verb: string, base: SystemBodyBase) =>
  `${verb}รถทะเบียน ${base.plate} (${base.reference})`;

/**
 * Each kind's fixed closing paragraph — the last thing the system says
 * before the optional note and the signature. Shared with extractNote so
 * the log can tell a note from the system's own words without a second
 * stored field: the note is whatever sits between the closing and the
 * signature.
 */
const CLOSING_TH = {
  CHECKIN: "ทางอู่จะตรวจสอบสภาพรถและส่งใบเสนอราคาให้ท่านทาง LINE นี้นะคะ",
  WORK_STARTED: "ช่างได้เริ่มดำเนินการซ่อมแล้วค่ะ ทางอู่จะอัปเดตความคืบหน้าให้ทราบเป็นระยะนะคะ",
  WAITING_PARTS_OPENING: "ขณะนี้งานอยู่ระหว่างรออะไหล่ค่ะ",
  PARTS_ARRIVED: "อะไหล่มาถึงแล้ว ช่างได้ดำเนินการต่อเรียบร้อยค่ะ",
  JOB_COMPLETED_PHOTOS: "ทางอู่แนบรูปงานที่เสร็จมาให้ดูด้วยนะคะ",
  IN_QC: "งานซ่อมทั้งหมดเสร็จแล้ว ขณะนี้อยู่ระหว่างตรวจสอบคุณภาพขั้นสุดท้ายก่อนส่งมอบค่ะ",
  READY_PICKUP: "รถพร้อมให้เข้ามารับได้แล้วค่ะ",
  READY_AMOUNT: "ยอดชำระในส่วนของท่าน ",
  DELIVERED: "หากมีข้อสงสัยหรือพบปัญหาใด ๆ หลังการซ่อม ติดต่อทางอู่ได้เลยค่ะ",
  CATCH_UP_STATUS: "สถานะงานซ่อมขณะนี้",
} as const;

/** Check-in: we have your car; we will inspect it and send a quotation. */
export function buildCheckinBody(base: SystemBodyBase): string {
  return systemBody(base, carLine("ทางอู่ได้รับรถ", base) + " เรียบร้อยแล้วค่ะ", [
    [CLOSING_TH.CHECKIN],
  ]);
}

/** Work started — once per case, on the Stage first reaching In progress. */
export function buildWorkStartedBody(base: SystemBodyBase): string {
  return systemBody(base, carLine("อัปเดตงานซ่อม", base), [
    [CLOSING_TH.WORK_STARTED],
  ]);
}

/** Waiting for parts, with the earliest expected arrival or "soon". */
export function buildWaitingPartsBody(base: SystemBodyBase & { etaDate: Date | null }): string {
  const when = base.etaDate
    ? `คาดว่าอะไหล่จะมาถึงประมาณวันที่ ${formatThaiDate(base.etaDate)}`
    : "คาดว่าอะไหล่จะมาถึงเร็ว ๆ นี้";
  return systemBody(base, carLine("อัปเดตงานซ่อม", base), [
    [CLOSING_TH.WAITING_PARTS_OPENING, `${when} แล้วทางอู่จะดำเนินการต่อทันทีนะคะ`],
  ]);
}

/** Parts arrived — work resumed. */
export function buildPartsArrivedBody(base: SystemBodyBase): string {
  return systemBody(base, carLine("อัปเดตงานซ่อม", base), [
    [CLOSING_TH.PARTS_ARRIVED],
  ]);
}

/** One Job finished, its photos following as images. */
export function buildJobCompletedBody(base: SystemBodyBase & { jobTitle: string }): string {
  return systemBody(base, carLine("อัปเดตงานซ่อม", base), [
    [`รายการ "${base.jobTitle}" เสร็จเรียบร้อยแล้วค่ะ`, CLOSING_TH.JOB_COMPLETED_PHOTOS],
  ]);
}

/** The case entered In QC: final quality check. */
export function buildInQcBody(base: SystemBodyBase): string {
  return systemBody(base, carLine("อัปเดตงานซ่อม", base), [
    [CLOSING_TH.IN_QC],
  ]);
}

/**
 * Ready to collect, naming the Customer-owed amount only — the builder does
 * not take an insurer's figure at all — and no money line when settled.
 */
export function buildReadyBody(base: SystemBodyBase & { customerOwedSatang: number }): string {
  const paragraphs: string[][] = [[CLOSING_TH.READY_PICKUP]];
  if (base.customerOwedSatang > 0) {
    paragraphs.push([`${CLOSING_TH.READY_AMOUNT}${formatBaht(base.customerOwedSatang)}`]);
  }
  return systemBody(base, carLine("งานซ่อม", base) + " เสร็จเรียบร้อยแล้ว", paragraphs);
}

/** Delivered: a thank-you with no money line, ever (CONTEXT.md Milestone message). */
export function buildDeliveredBody(base: SystemBodyBase): string {
  return systemBody(base, carLine("ขอบคุณที่ไว้วางใจให้ทางอู่ดูแล", base) + " นะคะ", [
    [CLOSING_TH.DELIVERED],
  ]);
}

/**
 * The catch-up a newly linked LINE Contact receives: the case as it stands
 * now, in the draft's own status lines — one message in place of everything
 * missed while unreachable, never a replay.
 */
export function buildCatchUpBody(
  base: SystemBodyBase & {
    jobs: DraftJob[];
    caseStatus: "CHECKED_IN" | "READY" | "DELIVERED";
  },
): string {
  const paragraphs: string[][] = [
    ["เชื่อมต่อ LINE เรียบร้อยแล้ว ทางอู่จะส่งอัปเดตงานซ่อมให้ท่านทางนี้นะคะ"],
    [CLOSING_TH.CATCH_UP_STATUS, ...statusLinesTh(base.jobs)],
  ];
  if (base.caseStatus === "READY") paragraphs.push([CLOSING_TH.READY_PICKUP]);
  return systemBody(base, carLine("เรื่องงานซ่อม", base), paragraphs);
}

/** Whether this paragraph is the kind's own closing, i.e. not a note. */
function isSystemClosing(kind: LineUpdateKind, paragraph: string): boolean {
  switch (kind) {
    case "CHECKIN":
      return paragraph === CLOSING_TH.CHECKIN;
    case "WORK_STARTED":
      return paragraph === CLOSING_TH.WORK_STARTED;
    case "WAITING_PARTS":
      return paragraph.startsWith(CLOSING_TH.WAITING_PARTS_OPENING);
    case "PARTS_ARRIVED":
      return paragraph === CLOSING_TH.PARTS_ARRIVED;
    case "JOB_COMPLETED":
      return paragraph.endsWith(CLOSING_TH.JOB_COMPLETED_PHOTOS);
    case "IN_QC":
      return paragraph === CLOSING_TH.IN_QC;
    case "READY":
      return paragraph === CLOSING_TH.READY_PICKUP || paragraph.startsWith(CLOSING_TH.READY_AMOUNT);
    case "DELIVERED":
      return paragraph === CLOSING_TH.DELIVERED;
    case "CATCH_UP":
      return paragraph === CLOSING_TH.READY_PICKUP || paragraph.startsWith(CLOSING_TH.CATCH_UP_STATUS);
    case "QUOTATION":
    case "FREEFORM":
      return true;
  }
}

/**
 * The optional note a Staff act appended to a system message, read back out
 * of the immutable body for the log (D-29: "the note's presence"). A note is
 * the paragraph between the kind's fixed closing and the signature; a
 * human-written or quotation message has no system closing, so never one.
 */
export function extractNote(kind: LineUpdateKind, bodyText: string): string | null {
  if (kind === "FREEFORM" || kind === "QUOTATION") return null;
  const paragraphs = bodyText.split("\n\n");
  // greeting block · at least one system paragraph · [note] · signature
  if (paragraphs.length < 4) return null;
  const candidate = paragraphs[paragraphs.length - 2]!;
  return isSystemClosing(kind, candidate) ? null : candidate;
}
