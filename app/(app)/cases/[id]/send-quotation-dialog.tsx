"use client";

import { ExternalLink, Printer, Send, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Segmented } from "@/components/blocks/segmented";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogContent, DialogFooter, DialogRow } from "@/components/ui/dialog";
import {
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
import type { SentUpdateDto } from "@/lib/line-send";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { SendBlockedReason } from "./customer-timeline";
import { sendQuotation, type SendQuotationError } from "./quotation-actions";

/**
 * Send quotation (D-25): what goes — the payer part's priced lines and their
 * total, a warning for any unpriced line left behind — and two ways out:
 * Send over LINE, or Print. The version is stamped on the way (a new one
 * only when the lines changed since the last), and the advisor never sees a
 * version number until it exists. The insurer's part is printed, never
 * pushed. When the LINE gate blocks, the dialog says why in the composer's
 * own words and Print remains.
 */

export function SendQuotationDialog({
  caseId,
  jobs,
  quotations,
  parts,
  initialPart,
  blockedReason,
  recipientName,
  onSent,
  onClose,
}: {
  caseId: string;
  jobs: JobDto[];
  quotations: QuotationDto[]; // newest first
  parts: OfferPart[];
  initialPart: OfferPart | null;
  blockedReason: SendBlockedReason;
  recipientName: string;
  onSent: (quotation: QuotationDto, update: SentUpdateDto | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations("jobs");
  const tq = useTranslations("quotations");
  const tl = useTranslations("customerTimeline");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [part, setPart] = useState<OfferPart>(initialPart ?? parts[0] ?? { payerType: "CUSTOMER", insurerName: null });
  const [busy, setBusy] = useState<null | "LINE" | "PRINT">(null);
  const [error, setError] = useState<SendQuotationError | null>(null);
  const [sentLabel, setSentLabel] = useState<string | null>(null);

  const lines = pricedOfferLines(jobs, part);
  const total = lines.reduce((sum, job) => sum + (job.priceSatang ?? 0), 0);
  const unpriced = jobs.filter(
    (job) => job.status === "PROPOSED" && job.priceSatang == null && samePart(partOf(job), part),
  );
  const covering = coveringQuotation(quotations, lines);
  const latest = latestQuotationForPart(quotations, part);
  const insurer = part.payerType === "INSURER";
  const blocked = insurer ? null : blockedReason;

  const versionHint = covering
    ? t("send.reuseHint", { label: covering.label })
    : latest
      ? t("send.newHint", { label: latest.label })
      : t("send.firstHint");

  async function go(via: "LINE" | "PRINT") {
    if (busy || lines.length === 0) return;
    setBusy(via);
    setError(null);
    // Opened synchronously inside the click so the popup blocker allows it;
    // pointed at the document once the version exists.
    const tab = via === "PRINT" ? window.open("", "_blank") : null;
    try {
      const res = await sendQuotation(caseId, {
        payerType: part.payerType,
        insurerName: part.insurerName ?? undefined,
        via,
      });
      if (!res.ok) {
        tab?.close();
        if (res.quotation) onSent(res.quotation, null);
        setError(res.error);
        return;
      }
      onSent(res.value.quotation, res.value.update);
      if (via === "PRINT") {
        const url = `/cases/${caseId}/quotations/${res.value.quotation.id}`;
        if (tab) tab.location.href = url;
        else window.open(url, "_blank");
        onClose();
        return;
      }
      setSentLabel(res.value.quotation.label);
    } finally {
      setBusy(null);
    }
  }

  const errorText = (code: SendQuotationError) =>
    tq.has(`errors.${code}` as never)
      ? tq(`errors.${code}` as never)
      : tl.has(`errors.${code}` as never)
        ? tl(`errors.${code}` as never)
        : t("errors.failed");

  return (
    <DialogContent title={t("send.title")} description={t("send.description")}>
      <DialogBody>
        {parts.length > 1 && (
          <DialogRow label={t("send.partLabel")}>
            <Segmented
              size="sm"
              aria-label={t("send.partLabel")}
              value={partKey(part)}
              onChange={(key) => {
                const next = parts.find((candidate) => partKey(candidate) === key);
                if (next) {
                  setPart(next);
                  setError(null);
                  setSentLabel(null);
                }
              }}
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

        {lines.length === 0 ? (
          <p className="text-xs text-faint">{tq("nothingToQuote")}</p>
        ) : (
          <div className="border">
            <div className="flex items-center gap-2 border-b border-dashed px-3 py-1.5">
              <span className="num text-[10.5px] text-faint">
                {t("send.linesHead", { count: lines.length, total: formatBaht(total) })}
              </span>
              <span className="ml-auto text-[10.5px] text-muted-foreground">{versionHint}</span>
            </div>
            <ul>
              {lines.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center gap-3 border-b border-dashed px-3 py-2 text-[13px] last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate">{job.title}</span>
                  <span className="num">{formatBaht(job.priceSatang!)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {unpriced.length > 0 && (
          <p className="flex items-start gap-2 text-[11.5px] text-warn">
            <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden />
            {t("send.unpricedWarning", { count: unpriced.length })}
          </p>
        )}

        {insurer ? (
          <p className="text-[11.5px] text-muted-foreground">{t("send.insurerPrintOnly")}</p>
        ) : blocked ? (
          <p
            role="status"
            className="flex items-start gap-2 border border-warn/45 px-2.5 py-2 text-[11.5px] text-warn"
          >
            <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden />
            {tl(`blocked.${blocked}`)}
          </p>
        ) : (
          <p className="text-[11px] text-faint">{t("send.lineHint", { name: recipientName })}</p>
        )}

        {sentLabel && (
          <p className="flex items-center gap-2 border border-ok/45 px-2.5 py-1.5 text-[11.5px] text-ok">
            {t("send.sent", { label: sentLabel, name: recipientName })}
            {latest?.publicToken && (
              <Link
                href={`/q/${latest.publicToken}`}
                target="_blank"
                className="ml-auto flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden />
                {t("send.openDocument")}
              </Link>
            )}
          </p>
        )}

        {error && (
          <p role="alert" className="border border-bad/45 px-2 py-1 text-[11px] text-bad">
            {errorText(error)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        {!insurer && (
          <Button
            type="button"
            size="sm"
            disabled={busy != null || lines.length === 0 || blocked != null}
            className="h-8 font-semibold"
            onClick={() => void go("LINE")}
          >
            <Send data-icon="inline-start" />
            {busy === "LINE" ? t("send.sending") : t("send.send")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant={insurer ? "default" : "outline"}
          disabled={busy != null || lines.length === 0}
          className={cn("h-8", insurer && "font-semibold")}
          onClick={() => void go("PRINT")}
        >
          <Printer data-icon="inline-start" />
          {t("send.print")}
        </Button>
        {latest && !sentLabel && (
          <span className="num text-[10.5px] text-faint">
            {latest.sentAt
              ? t("offer.sentLine", {
                  label: latest.label,
                  date: format.dateTime(new Date(latest.sentAt), { day: "numeric", month: "short" }),
                })
              : t("offer.issuedLine", {
                  label: latest.label,
                  date: format.dateTime(new Date(latest.issuedAt), { day: "numeric", month: "short" }),
                })}
          </span>
        )}
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-8" onClick={onClose}>
          {sentLabel ? tc("back") : tc("cancel")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
