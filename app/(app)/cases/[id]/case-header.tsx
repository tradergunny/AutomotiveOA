import { CarFront, Clock, Truck } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import {
  SPINE_STEPS,
  spineStepFor,
  type NextMove,
  type Stage,
  type WaitingBlocker,
} from "@/lib/case-flow";
import type { BodyType, RepairCaseStatus } from "@/lib/generated/prisma/enums";
import { formatBaht } from "@/lib/money";
import { formatPhone } from "@/lib/normalize";
import type { CaseBalance } from "@/lib/payments";
import { cn } from "@/lib/utils";
import { CaseFlowPanel } from "./case-flow-panel";
import { NextActionStrip } from "./next-action-strip";

/**
 * The rebuilt case header (M7.5 brief §3; D-6, D-9, D-10): one identity-plus-
 * state card. Car photo · plate · contact on top, the stage spine with the
 * sub-state beneath the lit step, then the next-action strip with exactly one
 * money line. The lifecycle badge, rollup chips, and due chips are gone —
 * Stage is the only state language spoken here. Since M7.7 (D-22) the
 * strip's Jobs actions open their dialogs rather than scrolling to an anchor.
 */

export type CaseHeaderProps = {
  repairCase: {
    id: string;
    reference: string;
    status: RepairCaseStatus;
    checkedInAt: Date;
    odometerKm: number | null;
    readyAt: Date | null;
    deliveredAt: Date | null;
    deliveredByName: string | null;
  };
  vehicle: {
    id: string;
    plate: string;
    bodyType: BodyType;
    make: string | null;
    model: string | null;
    color: string | null;
  };
  contact: { id: string; name: string; phone: string; company: string | null };
  /** First check-in walkaround photo (D-9) — body-type icon when none yet. */
  photoId: string | null;
  stage: Stage;
  move: NextMove;
  blocker: WaitingBlocker;
  counts: { proposed: number; inProgress: number; inQc: number };
  /** Distinct technicians across in-progress jobs — the WORK sub-state. */
  technicians: string[];
  balance: CaseBalance;
  proposedTotalSatang: number;
  canMarkReady: boolean;
  canDeliver: boolean;
};

export function CaseHeader({
  repairCase,
  vehicle,
  contact,
  photoId,
  stage,
  move,
  blocker,
  counts,
  technicians,
  balance,
  proposedTotalSatang,
  canMarkReady,
  canDeliver,
}: CaseHeaderProps) {
  const t = useTranslations("cases");
  const tw = useTranslations("waitingReasons");
  const tp = useTranslations("payments");
  const format = useFormatter();

  const descriptors = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ");
  const BodyIcon = vehicle.bodyType === "PICKUP" ? Truck : CarFront;
  const currentStep = SPINE_STEPS.indexOf(spineStepFor(stage));

  /* The sub-state written beneath the lit step (D-6). */
  const subState = (() => {
    switch (stage) {
      case "AWAITING_AUTH":
        return t("sub.awaitingAuth", { count: counts.proposed });
      case "WAITING":
        return t("sub.waiting", {
          reasons: blocker.reasons.map((reason) => tw(reason).toLocaleLowerCase()).join(" · "),
        });
      case "IN_PROGRESS":
        return technicians.length > 0
          ? `${t("sub.inProgress", { count: counts.inProgress })} · ${technicians.join(" · ")}`
          : t("sub.inProgress", { count: counts.inProgress });
      case "IN_QC":
        return t("sub.inQc", { count: counts.inQc });
      case "READY":
        return repairCase.readyAt
          ? t("sub.ready", { when: format.relativeTime(repairCase.readyAt) })
          : null;
      case "BALANCE_DUE":
        return t("sub.balanceDue", { amount: formatBaht(balance.totalDueSatang) });
      case "DELIVERED":
        return repairCase.deliveredAt
          ? t("sub.delivered", {
              date: format.dateTime(repairCase.deliveredAt, { day: "numeric", month: "short" }),
              name: repairCase.deliveredByName ?? "—",
            })
          : null;
      default:
        return null;
    }
  })();

  /* The one money line (D-6). BALANCE_DUE's blended amount already sits
     beside the lit step, so the strip names the side(s) still owing —
     the payments vocabulary, as tinted words. */
  const owedTotal = balance.customer.owedSatang + balance.insurer.owedSatang;
  const paidTotal = balance.customer.paidSatang + balance.insurer.paidSatang;
  const dueSides = (
    [
      ["CUSTOMER", balance.customer] as const,
      ["INSURER", balance.insurer] as const,
    ]
  )
    .filter(([, side]) => side.dueSatang > 0)
    .map(([side, sideBalance]) =>
      tp("dueChip", {
        payer: tp(`payer.${side}`),
        amount: formatBaht(sideBalance.dueSatang),
      }),
    );
  const moneyLine = (() => {
    switch (stage) {
      case "AWAITING_AUTH":
        return proposedTotalSatang > 0
          ? { text: t("money.proposed", { amount: formatBaht(proposedTotalSatang) }), tone: "text-warn" }
          : null;
      case "WAITING":
      case "IN_PROGRESS":
      case "IN_QC":
        if (owedTotal <= 0) return null;
        return {
          text:
            paidTotal > 0
              ? t("money.authorizedPaid", {
                  amount: formatBaht(owedTotal),
                  paid: formatBaht(paidTotal),
                })
              : t("money.authorized", { amount: formatBaht(owedTotal) }),
          tone: "text-muted-foreground",
        };
      case "READY":
        if (balance.totalDueSatang > 0) {
          // Insurer money isn't collected at the counter — name the sides
          // whenever it is part of what's due.
          const text =
            dueSides.length > 1 || balance.insurer.dueSatang > 0
              ? `${t("money.collect", { amount: formatBaht(balance.totalDueSatang) })} · ${dueSides.join(" · ")}`
              : t("money.collect", { amount: formatBaht(balance.totalDueSatang) });
          return { text, tone: "text-warn" };
        }
        return paidTotal > 0 ? { text: t("money.settled"), tone: "text-ok" } : null;
      case "BALANCE_DUE":
        return { text: dueSides.join(" · "), tone: "text-bad" };
      case "DELIVERED":
        return owedTotal > 0 || paidTotal > 0
          ? { text: t("money.settled"), tone: "text-ok" }
          : null;
      default:
        return null;
    }
  })();

  /* The Waiting blocker replaces the button (D-6): the thing itself. */
  const blockerLine =
    stage === "WAITING" && blocker.reasons.includes("PARTS") ? (
      blocker.pendingParts > 0 ? (
        <span className="flex items-center gap-1.5 text-xs text-warn">
          <Clock className="size-3.5" aria-hidden />
          {blocker.nextEta
            ? t("blocker.partsEta", {
                count: blocker.pendingParts,
                date: format.dateTime(blocker.nextEta, { day: "numeric", month: "short" }),
              })
            : t("blocker.parts", { count: blocker.pendingParts })}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-ok">
          <Clock className="size-3.5" aria-hidden />
          {t("blocker.partsArrived")}
        </span>
      )
    ) : null;

  const hasStrip =
    move.primary != null ||
    move.secondary != null ||
    blockerLine != null ||
    canMarkReady ||
    canDeliver ||
    moneyLine != null;

  return (
    <header className="relative border bg-card">
      <CornerTicks />

      {/* identity: the car's face, the case, the person (D-9, D-10) */}
      <div className="flex items-start gap-3.5 p-4 sm:gap-4 sm:p-5">
        {photoId ? (
          <a
            href={`/api/photos/${photoId}`}
            target="_blank"
            rel="noreferrer"
            className="block flex-none border bg-surface-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; next/image would re-fetch without the session cookie */}
            <img
              src={`/api/photos/${photoId}`}
              alt={t("carPhotoAlt", { plate: vehicle.plate })}
              className="size-16 object-cover sm:size-20"
            />
          </a>
        ) : (
          <span className="flex size-16 flex-none items-center justify-center border bg-surface-2 sm:size-20">
            <BodyIcon className="size-7 text-faint" aria-hidden />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-mono text-lg font-semibold tracking-tight text-primary">
              {repairCase.reference}
            </h1>
            <Link
              href={`/vehicles/${vehicle.id}`}
              className="border border-border-strong px-2 py-0.5 font-mono text-[13px] hover:border-primary-dim hover:text-primary"
            >
              {vehicle.plate}
            </Link>
            {descriptors && (
              <span className="text-sm text-muted-foreground">{descriptors}</span>
            )}
          </div>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 text-sm">
            <Link href={`/customers/${contact.id}`} className="font-medium hover:text-primary">
              {contact.name}
            </Link>
            {contact.company && (
              <span className="text-xs text-muted-foreground">{contact.company}</span>
            )}
            <a href={`tel:${contact.phone}`} className="num text-[13px] text-muted-foreground hover:text-primary">
              {formatPhone(contact.phone)}
            </a>
          </p>
          <p className="num mt-1.5 text-[11px] text-faint">
            {t("checkedInLine", {
              date: format.dateTime(repairCase.checkedInAt, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
            {repairCase.odometerKm != null &&
              ` · ${t("odometerValue", { km: format.number(repairCase.odometerKm) })}`}
          </p>
        </div>
      </div>

      {/* the stage spine (D-6) */}
      <ol className="flex gap-1 border-t border-dashed px-4 pb-3.5 pt-3 sm:px-5">
        {SPINE_STEPS.map((step, index) => {
          const state =
            index < currentStep ? "done" : index === currentStep ? "current" : "todo";
          return (
            <li
              key={step}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex-1 border-t-2 pt-1.5",
                state === "done" && "border-primary-dim",
                state === "current" && "border-primary",
                state === "todo" && "border-border",
              )}
            >
              <span
                className={cn(
                  "block truncate text-[11px]",
                  state === "current" && "font-semibold text-foreground",
                  state === "done" && "text-muted-foreground",
                  state === "todo" && "text-faint",
                )}
              >
                {t(`spine.${step}`)}
              </span>
              {state === "current" && subState && (
                <span
                  className={cn(
                    "mt-0.5 block text-[11px]",
                    stage === "BALANCE_DUE" ? "num text-bad" : "text-muted-foreground",
                  )}
                >
                  {subState}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* the next-action strip + the one money line (D-6) */}
      {hasStrip && (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed px-4 py-3 sm:px-5">
          {/* Since M7.7 the Jobs actions open their dialogs (D-22) — a client strip. */}
          <NextActionStrip caseId={repairCase.id} move={move} />
          {blockerLine}
          <CaseFlowPanel
            caseId={repairCase.id}
            canMarkReady={canMarkReady}
            canDeliver={canDeliver}
            deliverPrimary={move.primary === "MARK_DELIVERED"}
          />
          {moneyLine && (
            <span className={cn("num ml-auto text-[13px]", moneyLine.tone)}>
              {moneyLine.text}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
