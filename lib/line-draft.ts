import type { FindingCondition, JobStatus, WaitingReason } from "@/lib/generated/prisma/enums";
import { formatBaht } from "@/lib/money";

/**
 * The pre-filled LINE Update draft (ADR-003: "the system may pre-fill a
 * draft — a human presses send").
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

  const shown = input.jobs
    .map((job) => ({ job, status: customerStatusTh(job) }))
    .filter((row): row is { job: DraftJob; status: string } => row.status !== null);

  if (shown.length === 0) {
    lines.push("· อยู่ระหว่างตรวจสอบสภาพรถ");
  } else {
    for (const { job, status } of shown) {
      lines.push(`· ${job.title} — ${status}`);
    }
  }

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
