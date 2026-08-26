import type { JobStatus, WaitingReason } from "@/lib/generated/prisma/enums";

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

  lines.push("");
  lines.push(`${input.shopName}`);
  return lines.join("\n");
}
