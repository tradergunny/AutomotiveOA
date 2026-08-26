"use server";

import { revalidatePath } from "next/cache";
import { isQuotable, quotationNumberFor, type QuotationDto } from "@/lib/jobs";
import { tenantContext } from "@/lib/session";
import { QUOTATION_INCLUDE, toQuotationDto } from "./job-dto";

// Quotation issue (M4 brief §6, founder rulings): an EXPLICIT staff action —
// nothing auto-issues. Each issue snapshots the selected Jobs' titles and
// prices into an immutable Quotation row + lines; there is deliberately no
// update or delete action anywhere for quotations. One lineage per case:
// number from the case reference (RC-1024 → Q-1024), version counting up.

export type QuotationError =
  | "caseMissing"
  | "caseDelivered"
  | "noJobs"
  | "invalidJobs"
  | "failed";

export type QuotationResult =
  | { ok: true; value: QuotationDto }
  | { ok: false; error: QuotationError };

export async function issueQuotation(
  caseId: string,
  jobIds: string[],
): Promise<QuotationResult> {
  try {
    const { session, db } = await tenantContext();
    const repairCase = await db.repairCase.findUnique({
      where: { id: caseId },
      select: { id: true, status: true, reference: true },
    });
    if (!repairCase) return { ok: false, error: "caseMissing" };
    if (repairCase.status === "DELIVERED") return { ok: false, error: "caseDelivered" };

    const uniqueIds = [...new Set(jobIds)];
    if (uniqueIds.length === 0) return { ok: false, error: "noJobs" };

    const jobs = await db.job.findMany({
      where: { id: { in: uniqueIds }, caseId },
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
    // Every named Job must be this case's, priced, and still on offer.
    if (
      jobs.length !== uniqueIds.length ||
      jobs.some((job) => job.priceSatang == null || !isQuotable(job.status))
    ) {
      return { ok: false, error: "invalidJobs" };
    }

    const quotation = await db.$transaction(async (tx) => {
      const latest = await tx.quotation.aggregate({
        where: { caseId },
        _max: { version: true },
      });
      const created = await tx.quotation.create({
        data: {
          shopId: session.shopId,
          caseId,
          number: quotationNumberFor(repairCase.reference),
          version: (latest._max.version ?? 0) + 1,
          totalSatang: jobs.reduce((sum, job) => sum + job.priceSatang!, 0),
          issuedByStaffId: session.staffId,
        },
      });
      await tx.quotationLine.createMany({
        data: jobs.map((job, index) => ({
          shopId: session.shopId,
          quotationId: created.id,
          jobId: job.id,
          title: job.title,
          priceSatang: job.priceSatang!,
          payerType: job.payerType,
          insurerName: job.insurerName,
          sortOrder: index,
        })),
      });
      return created;
    });

    const fresh = await db.quotation.findUniqueOrThrow({
      where: { id: quotation.id },
      include: QUOTATION_INCLUDE,
    });
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, value: toQuotationDto(fresh) };
  } catch (error) {
    console.error("[quotations] issue failed:", error);
    return { ok: false, error: "failed" };
  }
}
