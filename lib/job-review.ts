import { latestQuotationForPart, partOf, samePart, type JobDto, type OfferPart, type QuotationDto } from "@/lib/jobs";

/** A partial response must not make the remaining lines look like a revised offer. */
export function reviewForPayer(jobs: JobDto[], quotations: QuotationDto[], part: OfferPart) {
  const pending = jobs.filter((job) => job.status === "PROPOSED" && samePart(partOf(job), part));
  const priced = pending.filter((job) => job.priceSatang != null);
  const quotation = latestQuotationForPart(quotations, part);
  const changed = !!quotation && pending.length > 0 && (
    priced.some((job) => !quotation.lines.some((line) => line.jobId === job.id && line.priceSatang === job.priceSatang)) ||
    quotation.lines.some((line) => {
      const job = jobs.find((item) => item.id === line.jobId);
      return !job || (job.status === "PROPOSED" && (!samePart(partOf(job), part) || job.priceSatang !== line.priceSatang));
    })
  );
  const readyForResponse = !!quotation && !changed && priced.length > 0 &&
    (part.payerType === "INSURER" || quotation.sentAt != null);
  const decisions = jobs.flatMap((job) => {
    const last = job.authorizations.at(-1);
    return last && quotation && last.quotationLabel === quotation.label ? [last] : [];
  });
  return {
    pending, priced, quotation, changed, readyForResponse,
    unpriced: pending.length - priced.length,
    approved: decisions.filter((auth) => auth.decision === "AUTHORIZED").length,
    declined: decisions.filter((auth) => auth.decision === "DECLINED").length,
    totalSatang: quotation && !changed ? quotation.totalSatang : priced.reduce((sum, job) => sum + job.priceSatang!, 0),
  };
}

export function jobEvidence(job: Pick<JobDto, "photos" | "findings">) {
  return [...new Map([
    ...job.findings.flatMap((finding) => finding.photos ?? []),
    ...job.photos,
  ].map((photo) => [photo.id, photo])).values()];
}
