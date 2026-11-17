"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { reviewForPayer } from "@/lib/job-review";
import { partKey, partOf, type JobDto, type OfferPart, type QuotationDto } from "@/lib/jobs";
import { formatBaht } from "@/lib/money";

/** Quotation evidence remains visible when its jobs move into Work or Done. */
export function QuotationReview({ caseId, jobs, quotations, isManager, onPrices, onSend, onRespond }: {
  caseId: string;
  jobs: JobDto[];
  quotations: QuotationDto[];
  isManager: boolean;
  onPrices: () => void;
  onSend: (part: OfferPart) => void;
  onRespond: (part: OfferPart) => void;
}) {
  const t = useTranslations("jobs");
  const format = useFormatter();
  const parts = [...new Map([
    ...jobs.filter((job) => job.status === "PROPOSED").map(partOf),
    ...quotations.flatMap((quote) => quote.lines.map(partOf)),
  ].map((part) => [partKey(part), part])).values()].sort((a, b) =>
    a.payerType === b.payerType ? (a.insurerName ?? "").localeCompare(b.insurerName ?? "") : a.payerType === "CUSTOMER" ? -1 : 1,
  );
  if (!parts.length) return null;
  const reviews = parts.map((part) => ({ part, ...reviewForPayer(jobs, quotations, part) }));
  const missing = jobs.filter((job) => job.status === "PROPOSED" && job.priceSatang == null);
  const editableMissing = missing.some((job) => !job.catalogItemId || isManager);
  const toSend = reviews.find((review) => review.priced.length && !review.readyForResponse);
  const toRespond = reviews.find((review) => review.readyForResponse);
  const next = editableMissing ? "prices" : toSend ? "review" : toRespond ? "response" : missing.length ? "manager" : null;
  const nextPart = toSend?.part ?? toRespond?.part;
  const label = (part: OfferPart) => part.payerType === "CUSTOMER" ? t("payer.CUSTOMER") : part.insurerName ?? t("payer.INSURER");

  return (
    <section className="border-t" aria-label={t("review.quotations")}>
      <div className="px-4 py-4 sm:px-5">
        <h4 className="text-[13px] font-semibold">{t("review.quotations")}</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {reviews.map(({ part, pending, priced, quotation, changed, unpriced, approved, declined, totalSatang }) => (
            <div key={partKey(part)} className="min-w-0 border bg-surface-2/30 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium">{label(part)}</span>
                <span className="num text-[13px]">{formatBaht(totalSatang)}</span>
              </div>
              {quotation ? (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
                  <Link className="font-mono text-primary hover:underline" href={`/cases/${caseId}/quotations/${quotation.id}`}>{quotation.label}</Link>
                  <span className="text-muted-foreground">{quotation.sentAt ? t("offer.sentVia", { date: format.dateTime(new Date(quotation.sentAt), { day: "numeric", month: "short" }) }) : t("review.documentPrepared")}</span>
                </div>
              ) : <p className="mt-2 text-[11px] text-muted-foreground">{t("review.draftCount", { count: priced.length })}</p>}
              {changed && <p className="mt-1 text-[11px] text-warn">{t("offer.stale")}</p>}
              {unpriced > 0 && <p className="mt-1 text-[11px] text-warn">{t("review.unpricedCount", { count: unpriced })}</p>}
              {(approved > 0 || declined > 0) && <p className="mt-1 text-[11px] text-muted-foreground">{t("review.decisions", { approved, declined })}</p>}
              {quotation && pending.length > 0 && !changed && <p className="mt-1 text-[11px] text-muted-foreground">{t("review.pendingCount", { count: pending.length })}</p>}
              <p className="mt-2 text-[11px] text-muted-foreground">{t(part.payerType === "INSURER" ? "review.insurerDelivery" : "review.customerDelivery")}</p>
              {pending.length > 0 && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                {priced.length > 0 && <button type="button" className="text-left text-xs text-primary underline-offset-4 hover:underline" onClick={() => onSend(part)}>{t("review.reviewQuotation")}</button>}
                <button type="button" className="text-left text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline" onClick={() => onRespond(part)}>{t("offer.recordResponse")}</button>
              </div>}
            </div>
          ))}
        </div>
      </div>
      {next && <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-surface-2/50 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{t(`review.next.${next}`, { count: missing.length, payer: nextPart ? label(nextPart) : "" })}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t(`review.hint.${next}`)}</p>
        </div>
        {next !== "manager" && <Button type="button" size="sm" onClick={() => {
          if (next === "prices") onPrices();
          else if (next === "review" && toSend) onSend(toSend.part);
          else if (toRespond) onRespond(toRespond.part);
        }}>{t(next === "prices" ? "review.completePrices" : next === "review" ? "review.reviewQuotation" : "offer.recordResponse")}</Button>}
      </footer>}
    </section>
  );
}
