"use client";

import {
  CircleX,
  Clock,
  MessageCircle,
  MessageCircleOff,
  MessageCircleWarning,
  PhoneOutgoing,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBaht } from "@/lib/money";
import { formatPhone } from "@/lib/normalize";
import { cn } from "@/lib/utils";
import {
  dropFollowUp,
  markFollowUpContacted,
  reopenFollowUp,
  snoozeFollowUp,
  type FollowUpError,
} from "./actions";
import { isActionable, type FollowUpDto } from "./followup-dto";

/**
 * The worklist itself (M7 brief §5). Default view = actionable: OPEN plus
 * SNOOZED whose date has passed — derived at render, no cron (ADR-003).
 * "Open & compose" deep-links into the source case's composer with the
 * chase draft pre-filled (§6); the by-hand transitions live inline here.
 */

type Filter = "ACTIONABLE" | "SNOOZED" | "CONTACTED" | "DROPPED" | "ALL";
const FILTERS: Filter[] = ["ACTIONABLE", "SNOOZED", "CONTACTED", "DROPPED", "ALL"];

type PendingAction = { id: string; kind: "contact" | "snooze" | "drop" } | null;

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** Default snooze target: one month out — editable before confirming. */
function nextMonthIso(): string {
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
    next.getDate(),
  ).padStart(2, "0")}`;
}

export function FollowUpsList({ initialFollowUps }: { initialFollowUps: FollowUpDto[] }) {
  const t = useTranslations("followups");
  const ti = useTranslations("inspection");
  const tc = useTranslations("common");
  const format = useFormatter();

  const [followUps, setFollowUps] = useState(initialFollowUps);
  const [filter, setFilter] = useState<Filter>("ACTIONABLE");
  const [pending, setPending] = useState<PendingAction>(null);
  const [note, setNote] = useState("");
  const [snoozeDate, setSnoozeDate] = useState(nextMonthIso);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FollowUpError | null>(null);

  const today = todayIso();

  const counts = useMemo(() => {
    const actionable = followUps.filter((f) => isActionable(f, today)).length;
    return { actionable, all: followUps.length };
  }, [followUps, today]);

  const visible = followUps.filter((followUp) => {
    switch (filter) {
      case "ACTIONABLE":
        return isActionable(followUp, today);
      case "ALL":
        return true;
      default:
        return followUp.status === filter;
    }
  });

  function replaceRow(dto: FollowUpDto) {
    setFollowUps((list) => list.map((f) => (f.id === dto.id ? dto : f)));
  }

  function startAction(id: string, kind: NonNullable<PendingAction>["kind"]) {
    setPending({ id, kind });
    setNote("");
    setSnoozeDate(nextMonthIso());
    setError(null);
  }

  async function run(action: () => Promise<{ ok: true; value: FollowUpDto } | { ok: false; error: FollowUpError }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      replaceRow(res.value);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = (followUp: FollowUpDto) =>
    followUp.jobTitle ??
    (followUp.checklistItem ? ti(`checklist.${followUp.checklistItem}` as never) : "—");

  const lineChip = (followUp: FollowUpDto) => {
    if (followUp.lineState === "linked") {
      return (
        <span className="flex items-center gap-1 border border-ok/45 px-1.5 py-px text-[10px] text-ok">
          <MessageCircle className="size-3" aria-hidden />
          LINE
        </span>
      );
    }
    if (followUp.lineState === "unfollowed") {
      return (
        <span className="flex items-center gap-1 border border-bad/45 px-1.5 py-px text-[10px] text-bad">
          <MessageCircleWarning className="size-3" aria-hidden />
          {t("lineUnfollowed")}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 border border-border-strong px-1.5 py-px text-[10px] text-faint">
        <MessageCircleOff className="size-3" aria-hidden />
        {t("lineNone")}
      </span>
    );
  };

  const statusChip = (followUp: FollowUpDto) => {
    const tone =
      followUp.status === "OPEN"
        ? "border-warn/45 text-warn"
        : followUp.status === "SNOOZED"
          ? isActionable(followUp, today)
            ? "border-warn/45 text-warn"
            : "border-border-strong text-muted-foreground"
          : followUp.status === "CONTACTED"
            ? "border-ok/45 text-ok"
            : "border-border-strong text-faint";
    return (
      <span
        className={cn(
          "hatch-soft border px-1.5 py-px font-mono text-[9.5px] tracking-wider",
          tone,
        )}
      >
        {t(`status.${followUp.status}`)}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex border border-border-strong">
          {FILTERS.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={cn(
                "px-2.5 py-1 text-[11px]",
                index > 0 && "border-l border-border-strong",
                filter === option
                  ? "bg-primary-soft text-primary"
                  : "text-faint hover:text-foreground",
              )}
              aria-pressed={filter === option}
            >
              {t(`filters.${option}`)}
              {option === "ACTIONABLE" && counts.actionable > 0 && (
                <span className="num ml-1 text-[10px]">({counts.actionable})</span>
              )}
            </button>
          ))}
        </span>
        <span className="num ml-auto text-xs text-muted-foreground">
          {t("count", { count: counts.all })}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="border border-dashed px-3.5 py-8 text-center text-xs text-faint">
          {followUps.length === 0 ? t("empty") : t("emptyFiltered")}
        </p>
      ) : (
        <section className="relative border bg-card">
          <CornerTicks />
          <ul>
            {visible.map((followUp) => (
              <li
                key={followUp.id}
                className="flex flex-col gap-1.5 border-b border-dashed px-3.5 py-2.5 last:border-0"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{followUp.customerName}</span>
                  <span className="num text-xs text-muted-foreground">
                    {formatPhone(followUp.customerPhone)}
                  </span>
                  <span className="border border-border-strong px-1.5 py-px font-mono text-[11px]">
                    {followUp.plate}
                  </span>
                  {lineChip(followUp)}
                  <span className="ml-auto flex items-center gap-2">
                    {statusChip(followUp)}
                    <Link
                      href={`/cases/${followUp.caseId}`}
                      className="font-mono text-[11px] text-primary hover:underline"
                    >
                      {followUp.caseReference}
                    </Link>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="min-w-0">
                    {sourceLabel(followUp)}
                    {followUp.condition && (
                      <span className="ml-1.5 border border-warn/45 px-1 py-px text-[10px] text-warn">
                        {ti(`conditions.${followUp.condition}`)}
                      </span>
                    )}
                    {followUp.quotedPriceSatang != null && (
                      <span className="num ml-1.5 text-muted-foreground">
                        {t("quoted", { amount: formatBaht(followUp.quotedPriceSatang) })}
                      </span>
                    )}
                  </span>
                  <span className="num ml-auto text-[10.5px] text-faint">
                    {followUp.deliveredAt &&
                      t("deliveredOn", {
                        date: format.dateTime(new Date(followUp.deliveredAt), {
                          day: "numeric",
                          month: "short",
                        }),
                      })}
                    {followUp.status === "SNOOZED" &&
                      followUp.snoozedUntil &&
                      ` · ${t("snoozedUntil", {
                        date: format.dateTime(new Date(`${followUp.snoozedUntil}T00:00:00`), {
                          day: "numeric",
                          month: "short",
                        }),
                      })}`}
                  </span>
                </div>

                {(followUp.lastActionByName || followUp.lastActionNote) && (
                  <p className="text-[11px] text-muted-foreground">
                    {followUp.lastActionAt &&
                      `${format.dateTime(new Date(followUp.lastActionAt), {
                        day: "numeric",
                        month: "short",
                      })} · `}
                    {followUp.lastActionByName}
                    {followUp.lastActionNote && ` — “${followUp.lastActionNote}”`}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  {followUp.status !== "CONTACTED" && followUp.status !== "DROPPED" && (
                    <>
                      <Button asChild size="sm" variant="outline" className="h-6.5 text-[11px]">
                        <Link href={`/cases/${followUp.caseId}?followup=${followUp.id}`}>
                          <MessageCircle data-icon="inline-start" />
                          {t("open")}
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6.5 text-[11px]"
                        onClick={() => startAction(followUp.id, "contact")}
                      >
                        <PhoneOutgoing data-icon="inline-start" />
                        {t("markContacted")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6.5 text-[11px]"
                        onClick={() => startAction(followUp.id, "snooze")}
                      >
                        <Clock data-icon="inline-start" />
                        {t("snooze")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6.5 text-[11px] text-muted-foreground"
                        onClick={() => startAction(followUp.id, "drop")}
                      >
                        <CircleX data-icon="inline-start" />
                        {t("drop")}
                      </Button>
                    </>
                  )}
                  {(followUp.status === "CONTACTED" || followUp.status === "DROPPED") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6.5 text-[11px]"
                      disabled={busy}
                      onClick={() => void run(() => reopenFollowUp(followUp.id))}
                    >
                      <Undo2 data-icon="inline-start" />
                      {t("reopen")}
                    </Button>
                  )}
                </div>

                {pending?.id === followUp.id && (
                  <div className="flex flex-wrap items-center gap-1.5 border border-dashed p-2">
                    {pending.kind === "contact" && (
                      <>
                        <Input
                          value={note}
                          onChange={(e) => setNote(e.currentTarget.value)}
                          placeholder={t("contactNotePlaceholder")}
                          className="h-7 min-w-0 flex-1 text-xs"
                          autoFocus
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          className="h-7 font-semibold"
                          onClick={() =>
                            void run(() => markFollowUpContacted(followUp.id, note))
                          }
                        >
                          {t("markContacted")}
                        </Button>
                      </>
                    )}
                    {pending.kind === "snooze" && (
                      <>
                        <Input
                          type="date"
                          value={snoozeDate}
                          min={today}
                          onChange={(e) => setSnoozeDate(e.currentTarget.value)}
                          className="num h-7 w-36 text-xs"
                          autoFocus
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || !snoozeDate}
                          className="h-7 font-semibold"
                          onClick={() => void run(() => snoozeFollowUp(followUp.id, snoozeDate))}
                        >
                          {t("snoozeConfirm")}
                        </Button>
                      </>
                    )}
                    {pending.kind === "drop" && (
                      <>
                        <Input
                          value={note}
                          onChange={(e) => setNote(e.currentTarget.value)}
                          placeholder={t("dropReasonPlaceholder")}
                          className="h-7 min-w-0 flex-1 text-xs"
                          autoFocus
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !note.trim()}
                          className="h-7 border-bad/45 text-bad hover:bg-bad/10"
                          onClick={() => void run(() => dropFollowUp(followUp.id, note))}
                        >
                          {t("dropConfirm")}
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => setPending(null)}
                    >
                      {tc("cancel")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p role="alert" className="border border-bad/45 px-2 py-1 text-[11px] text-bad">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
