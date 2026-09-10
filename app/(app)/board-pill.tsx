"use client";

import { useFormatter, useTranslations } from "next-intl";
import { PILL_TONE, type AgeTone, type BoardPill, type PillTone } from "@/lib/board";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The row's one pill (D-26): the next step or the blocker, in sentence case
 * with a leading dot (D-27). Tone follows D-3 — amber for anything waiting
 * on a human, red for stalled or owed, blue for work in flight, green for
 * money to collect.
 */

const TONE_CLASS: Record<PillTone, string> = {
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  bad: "bg-bad/15 text-bad",
  info: "bg-info/15 text-info",
  quiet: "bg-surface-2 text-muted-foreground",
};

export function Pill({ pill, className }: { pill: BoardPill; className?: string }) {
  const t = useTranslations("board.pill");
  const tw = useTranslations("waitingReasons");
  const tp = useTranslations("payments.payer");
  const format = useFormatter();

  const label = (() => {
    switch (pill.kind) {
      case "INSPECT":
      case "NO_WORK":
      case "RESPONSE":
      case "DELIVER":
        return t(pill.kind);
      case "UNPRICED":
        return t("UNPRICED", { count: pill.count });
      case "NOT_SENT":
        return t("NOT_SENT", { amount: formatBaht(pill.amountSatang) });
      case "UNANSWERED":
        return t("UNANSWERED", { days: pill.days });
      case "WAITING_PARTS":
        return pill.eta
          ? t("WAITING_PARTS_ETA", {
              arrived: pill.arrived,
              total: pill.total,
              date: format.dateTime(new Date(pill.eta), { day: "numeric", month: "short" }),
            })
          : t("WAITING_PARTS", { arrived: pill.arrived, total: pill.total });
      case "WAITING":
        return t("WAITING", { reason: tw(pill.reason).toLocaleLowerCase() });
      case "IN_PROGRESS":
        return t("IN_PROGRESS", { count: pill.count });
      case "QC":
        return t("QC", { count: pill.count });
      case "NOT_COLLECTED":
        return t("NOT_COLLECTED", { days: pill.days });
      case "COLLECT":
        return t("COLLECT", { amount: formatBaht(pill.amountSatang) });
      case "OWED":
        return t("OWED", { payer: tp(pill.payer), amount: formatBaht(pill.amountSatang) });
    }
  })();

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap",
        TONE_CLASS[PILL_TONE[pill.kind]],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 flex-none rounded-full bg-current" />
      {label}
    </span>
  );
}

const AGE_CLASS: Record<AgeTone, string> = {
  quiet: "text-faint",
  muted: "text-muted-foreground",
  warn: "text-warn",
  bad: "text-bad",
};

/** "40m" / "5h" / "14d" since a moment, in the D-26 tones. */
export function AgeLabel({
  since,
  now,
  tone,
  className,
}: {
  since: string;
  now: string;
  tone: AgeTone;
  className?: string;
}) {
  const t = useTranslations("board.age");
  const minutes = Math.max(0, Math.floor((Date.parse(now) - Date.parse(since)) / 60_000));
  const label =
    minutes < 60
      ? t("minutes", { n: minutes })
      : minutes < 24 * 60
        ? t("hours", { n: Math.floor(minutes / 60) })
        : t("days", { n: Math.floor(minutes / (24 * 60)) });
  return <span className={cn("num text-[11.5px] whitespace-nowrap", AGE_CLASS[tone], className)}>{label}</span>;
}
