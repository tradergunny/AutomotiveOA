"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Segmented } from "@/components/blocks/segmented";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogContent, DialogFooter, DialogRow } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  AUTH_CHANNELS,
  coveringQuotation,
  latestQuotationForPart,
  partKey,
  partOf,
  pricedOfferLines,
  samePart,
  type JobDto,
  type OfferPart,
  type QuotationDto,
} from "@/lib/jobs";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";
import { recordOfferResponse, type JobError } from "./job-actions";
import { selectCls } from "./parts-table";

/**
 * Record response (D-20): the payer answers the Offer as a set. Channel, the
 * Quotation shown and a note are captured once; every line gets a Yes or a
 * No (an unpriced line offers No only and says why); one save writes every
 * decision in one transaction. Yes rows move to Work, No rows to Done. A
 * mixed Offer records one payer's answer at a time.
 */

type Decision = "AUTHORIZED" | "DECLINED";
type Channel = (typeof AUTH_CHANNELS)[number];

export function RecordResponseDialog({
  caseId,
  jobs,
  quotations,
  parts,
  initialPart,
  onSaved,
  onClose,
}: {
  caseId: string;
  jobs: JobDto[];
  quotations: QuotationDto[]; // newest first
  parts: OfferPart[];
  initialPart: OfferPart | null;
  onSaved: (decided: JobDto[]) => void;
  onClose: () => void;
}) {
  const t = useTranslations("jobs");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [part, setPart] = useState<OfferPart>(initialPart ?? parts[0] ?? { payerType: "CUSTOMER", insurerName: null });
  const [channel, setChannel] = useState<Channel>("LINE");
  const lines = jobs.filter((job) => job.status === "PROPOSED" && samePart(partOf(job), part));
  const priced = pricedOfferLines(jobs, part);
  // Default the Quotation to the latest version covering this part's priced
  // lines — the one the payer is most likely holding — else the latest for
  // the part, else none (the walk-in).
  const defaultQuotation = coveringQuotation(quotations, priced) ?? latestQuotationForPart(quotations, part);
  const [quotationId, setQuotationId] = useState<string>(defaultQuotation?.id ?? "");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<JobError | null>(null);

  const partQuotations = quotations.filter(
    (quotation) => quotation.lines.every((line) => samePart(line, part)),
  );
  const decided = lines.filter((job) => decisions[job.id]);
  const authorized = decided.filter((job) => decisions[job.id] === "AUTHORIZED").length;
  const declined = decided.length - authorized;
  const total = lines.reduce((sum, job) => sum + (job.priceSatang ?? 0), 0);

  function switchPart(key: string) {
    const next = parts.find((candidate) => partKey(candidate) === key);
    if (!next) return;
    setPart(next);
    setDecisions({});
    setError(null);
    const nextPriced = pricedOfferLines(jobs, next);
    setQuotationId(
      (coveringQuotation(quotations, nextPriced) ?? latestQuotationForPart(quotations, next))?.id ?? "",
    );
  }

  async function save() {
    if (busy || decided.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await recordOfferResponse(caseId, {
        payerType: part.payerType,
        insurerName: part.insurerName ?? undefined,
        channel,
        quotationId: quotationId || undefined,
        note,
        decisions: decided.map((job) => ({ jobId: job.id, decision: decisions[job.id]! })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved(res.value);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const partName =
    part.payerType === "CUSTOMER" ? null : (part.insurerName ?? t("payer.INSURER"));

  return (
    <DialogContent
      title={partName ? t("response.titleInsurer", { name: partName }) : t("response.title")}
      description={t("response.description")}
    >
      <DialogBody>
        {parts.length > 1 && (
          <DialogRow label={t("send.partLabel")}>
            <Segmented
              size="sm"
              aria-label={t("send.partLabel")}
              value={partKey(part)}
              onChange={switchPart}
              options={parts.map((candidate) => ({
                value: partKey(candidate),
                label:
                  candidate.payerType === "CUSTOMER"
                    ? t("payer.CUSTOMER")
                    : (candidate.insurerName ?? t("payer.INSURER")),
              }))}
            />
          </DialogRow>
        )}

        <DialogRow label={t("response.channelLabel")}>
          <Segmented
            aria-label={t("response.channelLabel")}
            value={channel}
            onChange={setChannel}
            options={AUTH_CHANNELS.map((option) => ({
              value: option,
              label: t(`auth.channel.${option}`),
            }))}
          />
        </DialogRow>

        <DialogRow label={t("response.quotationLabel")}>
          <select
            className={cn(selectCls, "h-8 min-w-44")}
            value={quotationId}
            onChange={(e) => setQuotationId(e.currentTarget.value)}
            aria-label={t("response.quotationLabel")}
          >
            <option value="">{t("response.noQuotation")}</option>
            {partQuotations.map((quotation) => (
              <option key={quotation.id} value={quotation.id}>
                {quotation.label} ·{" "}
                {format.dateTime(new Date(quotation.issuedAt), { day: "numeric", month: "short" })}
              </option>
            ))}
          </select>
        </DialogRow>

        <div className="border">
          <div className="flex items-center gap-2 border-b border-dashed px-3 py-1.5">
            <span className="num text-[10.5px] text-faint">
              {t("response.head", { count: lines.length, total: formatBaht(total) })}
            </span>
            <button
              type="button"
              className="ml-auto border border-border-strong px-2 py-0.5 text-[10.5px] text-faint hover:border-ok/50 hover:text-ok"
              onClick={() =>
                setDecisions(
                  Object.fromEntries(
                    lines
                      .filter((job) => job.priceSatang != null)
                      .map((job) => [job.id, "AUTHORIZED" as const]),
                  ),
                )
              }
            >
              {t("response.allYes")}
            </button>
          </div>
          <ul>
            {lines.map((job) => {
              const unpriced = job.priceSatang == null;
              return (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed px-3 py-1.5 text-[13px] last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate">{job.title}</span>
                  <span className={cn("num w-24 text-right", unpriced && "text-[10.5px] text-warn")}>
                    {unpriced ? t("response.needsPrice") : formatBaht(job.priceSatang!)}
                  </span>
                  <Segmented
                    size="sm"
                    aria-label={job.title}
                    value={decisions[job.id] ?? null}
                    onChange={(value) => setDecisions((all) => ({ ...all, [job.id]: value }))}
                    options={[
                      {
                        value: "AUTHORIZED" as const,
                        label: t("response.yes"),
                        tone: "ok" as const,
                        disabled: unpriced,
                        title: unpriced ? t("auth.needsPrice") : undefined,
                      },
                      { value: "DECLINED" as const, label: t("response.no"), tone: "bad" as const },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </div>

        <DialogRow label={t("response.noteLabel")}>
          <Input
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder={t("auth.notePlaceholder")}
            className="h-8 min-w-0 flex-1 text-xs"
          />
        </DialogRow>

        {error && (
          <p role="alert" className="border border-bad/45 px-2 py-1 text-[11px] text-bad">
            {t(`errors.${error}` as never)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <span className="text-[11px] text-muted-foreground">
          <span className={cn(authorized > 0 && "text-ok")}>
            {t("response.authorizedCount", { count: authorized })}
          </span>
          {" · "}
          <span className={cn(declined > 0 && "text-bad")}>
            {t("response.declinedCount", { count: declined })}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || decided.length === 0}
            className="h-8 font-semibold"
            onClick={() => void save()}
          >
            {t("response.save", { count: decided.length })}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onClose}>
            {tc("cancel")}
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  );
}
