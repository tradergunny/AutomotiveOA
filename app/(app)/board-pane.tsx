"use client";

import { ArrowRight, CarFront, Check, Clock, Truck, User } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import type { BoardCase, LedgerLine } from "@/lib/board";
import { SPINE_STEPS, spineStepFor, type StageAction } from "@/lib/case-flow";
import { formatBaht } from "@/lib/money";
import { formatPhone } from "@/lib/normalize";
import { cn } from "@/lib/utils";
import { Pill } from "./board-pill";

/**
 * The pane (D-26): the selected case. Walkaround photo (D-28), plate, stage
 * pill, three facts, the D-6 stage spine, the Offer or Work as a short
 * ledger, and two buttons — the next action and Open case. Actions deep-link
 * the case page so its dialog is already open on arrival (M7.9 §5).
 */

function actionHref(caseId: string, action: StageAction): string {
  switch (action) {
    case "OPEN_INSPECTION":
      return `/cases/${caseId}/inspection`;
    case "RECORD_QC":
      return `/cases/${caseId}#jobs`;
    case "RECORD_PAYMENT":
      return `/cases/${caseId}#money`;
    case "MARK_DELIVERED":
      return `/cases/${caseId}`;
    default:
      return `/cases/${caseId}?action=${action}`;
  }
}

export function BoardPane({ row }: { row: BoardCase }) {
  const t = useTranslations("board.pane");
  const tc = useTranslations("cases");
  const tf = useTranslations("cases.flow");
  const tj = useTranslations("jobStatus");
  const format = useFormatter();

  const actionLabel: Record<StageAction, string> = {
    OPEN_INSPECTION: tc("action.openInspection"),
    SET_PRICES: tc("action.setPrices"),
    SEND_QUOTATION: tc("action.sendQuotation"),
    RECORD_RESPONSE: tc("action.recordResponse"),
    RECORD_QC: tc("action.recordQc"),
    RECORD_PAYMENT: tc("action.recordPayment"),
    MARK_DELIVERED: tf("markDelivered"),
  };

  const BodyIcon = row.bodyType === "PICKUP" ? Truck : CarFront;
  // A photo whose file is gone (old staging runs) falls back to the icon.
  const [brokenPhotoId, setBrokenPhotoId] = useState<string | null>(null);
  const photoId = row.photoId && row.photoId !== brokenPhotoId ? row.photoId : null;
  const currentStep = SPINE_STEPS.indexOf(spineStepFor(row.stage));
  const shortDate = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short" });

  /* The middle fact: the date that explains the wait. */
  const keyDate = (() => {
    if (row.stage === "AWAITING_AUTH" && row.quoteSentAt) {
      return { label: t("quoteSent"), value: shortDate(row.quoteSentAt) };
    }
    if (row.stage === "READY" && row.readyAt) return { label: t("readySince"), value: shortDate(row.readyAt) };
    if (row.stage === "BALANCE_DUE" && row.deliveredAt) {
      return { label: t("delivered"), value: shortDate(row.deliveredAt) };
    }
    return { label: t("checkedIn"), value: shortDate(row.checkedInAt) };
  })();

  const ledger = (title: string, lines: LedgerLine[], receipt = false) =>
    lines.length === 0 ? null : (
      <div className="grid gap-2 px-5 pt-4">
        <h4 className="text-[12.5px] font-semibold">{title}</h4>
        {lines.map((line) => (
          <div key={line.id} className="flex justify-between gap-3 text-[12.5px]">
            <span className="truncate text-muted-foreground">{line.title}</span>
            <span className="num whitespace-nowrap">
              {receipt
                ? [tj(line.status).toLocaleLowerCase(), line.technician].filter(Boolean).join(" · ")
                : line.priceSatang != null
                  ? formatBaht(line.priceSatang)
                  : row.stage === "AWAITING_AUTH"
                    ? <span className="text-warn">{t("unpriced")}</span>
                    : [tj(line.status).toLocaleLowerCase(), line.technician].filter(Boolean).join(" · ")}
            </span>
          </div>
        ))}
      </div>
    );

  return (
    <aside className="rounded-[14px] border bg-card lift">
      <div className="p-5 pb-0">
        <div className="relative grid h-[170px] place-items-center overflow-hidden rounded-[12px] bg-surface-2 text-faint">
          {photoId ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated route
            <img
              src={`/api/photos/${photoId}`}
              alt={tc("carPhotoAlt", { plate: row.plate })}
              onError={() => setBrokenPhotoId(photoId)}
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <BodyIcon className="size-16" strokeWidth={1.2} aria-hidden />
          )}
          <span className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/45 to-transparent" aria-hidden />
          <span className="absolute bottom-2.5 left-3 text-[11px] text-white/85">
            {photoId ? t("walkaround") : t("noPhoto")}
          </span>
        </div>
      </div>

      <div className="flex items-start gap-3 px-5 pt-3.5">
        <div className="min-w-0">
          <div className="num text-xl font-semibold">{row.plate}</div>
          <div className="text-[13px] text-muted-foreground">
            {[[row.make, row.model].filter(Boolean).join(" "), row.reference].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Pill pill={row.pill} className="mt-1 ml-auto" />
      </div>

      <div className="grid grid-cols-3 gap-2.5 px-5 pt-4">
        <Fact icon={ArrowRight} label={t("nextStep")}>
          <span className={cn(row.next.primary ? "text-warn" : "text-muted-foreground")}>
            {row.next.primary ? actionLabel[row.next.primary] : t("none")}
          </span>
        </Fact>
        <Fact icon={Clock} label={keyDate.label}>{keyDate.value}</Fact>
        <Fact icon={User} label={t("contact")}>
          <span className="block truncate">{row.contactName}</span>
          <span className="num block text-xs font-medium text-muted-foreground">{formatPhone(row.contactPhone)}</span>
        </Fact>
      </div>

      <div className="mx-5 mt-4 rounded-[12px] border bg-surface-2/60 p-3.5">
        <div className="mb-2.5 flex justify-between text-[12.5px] font-semibold">
          {t("progress")}
          <span className="text-primary">{tc(`spine.${SPINE_STEPS[currentStep]}`)}</span>
        </div>
        <div className="relative mx-2 mb-3 h-1 rounded-[2px] bg-border">
          <span
            className="absolute inset-y-0 left-0 rounded-[2px] bg-primary"
            style={{ width: `${((currentStep + 0.5) / SPINE_STEPS.length) * 100}%` }}
          />
        </div>
        <div className="grid grid-cols-5 gap-1 text-center">
          {SPINE_STEPS.map((step, index) => {
            const done = index < currentStep;
            const current = index === currentStep;
            return (
              <div key={step} className="text-[10.5px] leading-tight text-faint">
                <span
                  className={cn(
                    "mx-auto mb-1.5 grid size-4 place-items-center rounded-full border-2",
                    done && "border-primary bg-primary text-primary-foreground",
                    current && "border-primary",
                    !done && !current && "border-border",
                  )}
                >
                  {done && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
                  {current && <span className="size-1.5 rounded-full bg-primary" />}
                </span>
                <span className={cn("block text-[11px] font-semibold", done && "text-foreground", current && "text-primary", !done && !current && "text-muted-foreground")}>
                  {tc(`spine.${step}`)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {ledger(t("offer"), row.ledger.offer)}
      {ledger(t("work"), row.ledger.work)}
      {ledger(t("done"), row.ledger.done, true)}

      <div className="flex gap-2.5 p-5">
        {row.next.primary && (
          <Link
            href={actionHref(row.id, row.next.primary)}
            className="inline-flex h-9 flex-1 items-center justify-center rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 active:translate-y-px"
          >
            {actionLabel[row.next.primary]}
          </Link>
        )}
        <Link
          href={`/cases/${row.id}`}
          className="inline-flex h-9 flex-1 items-center justify-center rounded-[10px] border border-border-strong px-4 text-[13px] font-semibold hover:bg-surface-2"
        >
          {t("openCase")}
        </Link>
      </div>
    </aside>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof ArrowRight;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <span className="grid size-[22px] place-items-center rounded-[6px] bg-primary/12 text-primary">
          <Icon className="size-3" aria-hidden />
        </span>
        {label}
      </span>
      <div className="mt-1 text-[13px] font-semibold">{children}</div>
    </div>
  );
}
