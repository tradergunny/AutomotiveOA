import {
  Ban,
  Banknote,
  CarFront,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Flag,
  FlagOff,
  History,
  PackageCheck,
  Play,
  Shield,
  ShieldCheck,
  ShieldX,
  Trash2,
  Undo2,
  UserCog,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { Prisma } from "@/lib/generated/prisma/client";
import { quotationLabel } from "@/lib/jobs";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The internal timeline (M5 brief §6): the case's operational story, staff
 * only, chronological. Labels render from typed event data through i18n keys
 * — free-text notes are shop-authored data and render verbatim. Nothing here
 * is ever customer-visible; the Customer Timeline is M6's composer (ADR-003).
 */

export const CASE_EVENT_INCLUDE = {
  actorStaff: { select: { name: true } },
  subjectStaff: { select: { name: true } },
  quotation: { select: { number: true, version: true } },
} as const satisfies Prisma.CaseEventInclude;

export type CaseEventRow = Prisma.CaseEventGetPayload<{
  include: typeof CASE_EVENT_INCLUDE;
}>;

type Entry = {
  icon: LucideIcon;
  tone: string;
  label: string;
  note?: string | null;
  actor: string;
  at: Date;
};

export function CaseTimeline({
  events,
  checkedInAt,
  openedByName,
}: {
  events: CaseEventRow[]; // ascending
  checkedInAt: Date;
  openedByName: string;
}) {
  const t = useTranslations("timeline");
  const ts = useTranslations("jobStatus");
  const tw = useTranslations("waitingReasons");
  const format = useFormatter();

  const reason = (event: CaseEventRow) =>
    event.waitingReason ? tw(event.waitingReason) : tw("OTHER");
  const job = (event: CaseEventRow) => ({ job: event.jobTitle ?? "—" });

  function toEntry(event: CaseEventRow): Entry {
    const base = { note: event.note, actor: event.actorStaff.name, at: event.at };
    switch (event.type) {
      case "JOB_CREATED":
        return { ...base, icon: Wrench, tone: "text-muted-foreground", label: t("jobCreated", job(event)) };
      case "JOB_DELETED":
        return { ...base, icon: Trash2, tone: "text-muted-foreground", label: t("jobDeleted", job(event)) };
      case "JOB_AUTHORIZATION_RECORDED":
        if (event.toStatus === "AUTHORIZED") {
          return { ...base, icon: CircleCheck, tone: "text-ok", label: t("jobAuthorized", job(event)) };
        }
        if (event.toStatus === "DECLINED") {
          return { ...base, icon: CircleX, tone: "text-bad", label: t("jobDeclined", job(event)) };
        }
        return { ...base, icon: Undo2, tone: "text-warn", label: t("authorizationReverted", job(event)) };
      case "JOB_STATUS_CHANGED":
        if (event.toStatus === "WAITING") {
          return {
            ...base,
            icon: Clock,
            tone: "text-warn",
            label: t("jobWaiting", { ...job(event), reason: reason(event) }),
          };
        }
        if (event.toStatus === "QC") {
          return { ...base, icon: Shield, tone: "text-info", label: t("sentToQc", job(event)) };
        }
        return { ...base, icon: Play, tone: "text-info", label: t("workStarted", job(event)) };
      case "JOB_WAITING_REASON_CHANGED":
        return {
          ...base,
          icon: Clock,
          tone: "text-warn",
          label: t("waitingReasonChanged", { ...job(event), reason: reason(event) }),
        };
      case "JOB_QC_PASSED":
        return { ...base, icon: ShieldCheck, tone: "text-ok", label: t("qcPassed", job(event)) };
      case "JOB_QC_FAILED":
        return { ...base, icon: ShieldX, tone: "text-bad", label: t("qcFailed", job(event)) };
      case "JOB_CANCELLED":
        return { ...base, icon: Ban, tone: "text-bad", label: t("jobCancelled", job(event)) };
      case "JOB_REVERTED":
        return {
          ...base,
          icon: Undo2,
          tone: "text-warn",
          label: t("jobReverted", {
            ...job(event),
            status: event.toStatus ? ts(event.toStatus) : "—",
          }),
        };
      case "JOB_ASSIGNED":
        return {
          ...base,
          icon: UserCog,
          tone: "text-muted-foreground",
          label: event.subjectStaff
            ? t("jobAssigned", { ...job(event), name: event.subjectStaff.name })
            : t("jobUnassigned", job(event)),
        };
      case "JOB_PRICE_OVERRIDDEN":
        return {
          ...base,
          icon: Banknote,
          tone: "text-warn",
          label: t("priceOverridden", {
            ...job(event),
            price: event.priceSatang != null ? formatBaht(event.priceSatang) : "—",
          }),
        };
      case "QUOTATION_ISSUED":
        return {
          ...base,
          icon: FileText,
          tone: "text-muted-foreground",
          label: t("quotationIssued", {
            label: event.quotation
              ? quotationLabel(event.quotation.number, event.quotation.version)
              : "—",
          }),
        };
      case "CASE_READY":
        return { ...base, icon: Flag, tone: "text-ok", label: t("caseReady") };
      case "CASE_READY_REVOKED":
        return { ...base, icon: FlagOff, tone: "text-warn", label: t("caseReadyRevoked") };
      case "CASE_DELIVERED":
        return { ...base, icon: PackageCheck, tone: "text-ok", label: t("caseDelivered") };
    }
  }

  const entries: Entry[] = [
    // Derived opening entry — pre-M5 cases start here with no backfill.
    {
      icon: CarFront,
      tone: "text-info",
      label: t("checkedIn"),
      actor: openedByName,
      at: checkedInAt,
    },
    ...events.map(toEntry),
  ];

  return (
    <section className="relative border bg-card">
      <header className="flex items-center gap-2 border-b border-dashed px-3.5 py-2.5">
        <History className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-[12.5px] font-semibold tracking-wide">{t("title")}</h3>
        <span className="border border-dashed border-border-strong px-1.5 py-px font-mono text-[9px] tracking-wider text-faint">
          {t("staffOnly")}
        </span>
        <span className="num ml-auto text-[10.5px] text-faint">
          {t("entryCount", { count: entries.length })}
        </span>
      </header>
      <ol>
        {entries.map((entry, index) => {
          const Icon = entry.icon;
          return (
            <li
              key={index}
              className="flex items-start gap-2.5 border-b border-dashed px-3.5 py-2 text-xs last:border-0"
            >
              <Icon className={cn("mt-px size-3.5 flex-none", entry.tone)} aria-hidden />
              <span className="min-w-0 flex-1">
                {entry.label}
                {entry.note && (
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    “{entry.note}”
                  </span>
                )}
              </span>
              <span className="num flex-none text-right text-[10px] text-faint">
                {format.dateTime(entry.at, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <span className="block">{entry.actor}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
