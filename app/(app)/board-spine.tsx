"use client";

import { CarFront, FileCheck, Landmark, Search, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SpineSegment, SpineSummary } from "@/lib/board";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The spine strip (D-26): the pipeline as five connected segments, each with
 * its count and the one number that matters there. A segment lights when a
 * case in it needs the advisor; tapping filters the list. The Balance-due
 * segment hides while nothing is owed, as the old group did.
 */

const ICON: Record<SpineSegment, typeof Search> = {
  ASSESSMENT: Search,
  AUTHORIZATION: FileCheck,
  WORK: Wrench,
  READY: CarFront,
  OWED: Landmark,
};

export function BoardSpine({
  summary,
  active,
  onSelect,
}: {
  summary: SpineSummary[];
  active: SpineSegment | null;
  onSelect: (segment: SpineSegment | null) => void;
}) {
  const t = useTranslations("board.spine");
  const ts = useTranslations("board.spineSub");
  const segments = summary.filter((s) => s.segment !== "OWED" || s.count > 0);

  const subline = (s: SpineSummary): { text: string; tone?: "warn" | "bad" } | null => {
    if (s.count === 0) return { text: ts("empty") };
    switch (s.segment) {
      case "ASSESSMENT":
        return { text: ts("waitingOnYou", { days: s.oldestDays }), tone: s.oldestDays >= 1 ? "warn" : undefined };
      case "AUTHORIZATION": {
        const parts = [ts("offered", { amount: formatBaht(s.amountSatang) })];
        if (s.unpriced > 0) parts.push(ts("unpriced", { count: s.unpriced }));
        parts.push(ts("oldest", { days: s.oldestDays }));
        return { text: parts.join(" · "), tone: s.oldestDays >= 7 ? "warn" : undefined };
      }
      case "WORK": {
        const parts = [];
        if (s.waiting > 0) parts.push(ts("waiting", { count: s.waiting }));
        if (s.inQc > 0) parts.push(ts("inQc", { count: s.inQc }));
        if (s.technicians.length > 0) parts.push(s.technicians.join(" · "));
        return { text: parts.join(" · ") || ts("working") };
      }
      case "READY": {
        const parts = [];
        if (s.amountSatang > 0) parts.push(ts("collect", { amount: formatBaht(s.amountSatang) }));
        if (s.uncollected > 0) parts.push(ts("uncollected", { count: s.uncollected }));
        return { text: parts.join(" · ") || ts("readyToGo"), tone: s.uncollected > 0 ? "bad" : undefined };
      }
      case "OWED":
        return { text: ts("outstanding", { amount: formatBaht(s.amountSatang), days: s.oldestDays }), tone: "bad" };
    }
  };

  return (
    <div
      className="grid overflow-hidden rounded-2xl border bg-card lift"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      role="tablist"
      aria-label={t("label")}
    >
      {segments.map((s) => {
        const Icon = ICON[s.segment];
        const sub = subline(s);
        const selected = active === s.segment;
        return (
          <button
            key={s.segment}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(selected ? null : s.segment)}
            className={cn(
              "relative grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 border-l px-5 py-4 text-left transition-colors first:border-l-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected && "bg-surface-2",
              s.hot && "border-l-[3px] border-l-primary first:border-l-[3px]",
            )}
          >
            <span className="text-[13px] leading-tight text-muted-foreground">{t(s.segment)}</span>
            <span
              className={cn(
                "row-span-3 hidden size-10 place-items-center rounded-full lg:grid",
                s.hot ? "bg-primary/12 text-primary" : "bg-surface-2 text-muted-foreground",
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
            </span>
            <span className="num text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">{s.count}</span>
            {sub && (
              <span
                className={cn(
                  "line-clamp-2 text-xs text-muted-foreground xl:line-clamp-1",
                  sub.tone === "warn" && "text-warn",
                  sub.tone === "bad" && "text-bad",
                )}
              >
                {sub.text}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
