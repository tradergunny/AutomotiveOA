"use client";

import { Inbox, MessageCircle, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import type { ArrivalQueueRow } from "@/lib/arrivals";
import { cn } from "@/lib/utils";

/**
 * The queue strip (M7.8 brief §4): the Shop's waiting Arrivals, newest first,
 * above section 01 of the wizard. It exists only when there is something in
 * it. One row each — name, plate, the first line of what's wrong, how long
 * ago, a LINE mark when identity came along — and a dismiss control. Tapping
 * a row pulls the Arrival into the wizard. Not a board: an Arrival is not a
 * case, and the rows are never chips (D-8).
 */
export function ArrivalQueue({
  rows,
  selectedId,
  onPull,
  onDismiss,
}: {
  rows: ArrivalQueueRow[];
  selectedId: string | null;
  onPull: (row: ArrivalQueueRow) => void;
  onDismiss: (row: ArrivalQueueRow) => Promise<void>;
}) {
  const t = useTranslations("checkin.arrivals");
  const format = useFormatter();
  const [dismissing, setDismissing] = useState<string | null>(null);

  return (
    <section className="relative border bg-card" aria-label={t("title")}>
      <CornerTicks />
      <header className="flex items-center gap-2.5 border-b border-dashed px-3.5 py-2">
        <Inbox className="size-3.5 text-primary" aria-hidden />
        <h2 className="text-[12.5px] font-semibold tracking-wide">{t("title")}</h2>
        <span className="num ml-auto text-[10.5px] text-muted-foreground">
          {t("count", { count: rows.length })}
        </span>
      </header>
      <ul>
        {rows.map((row) => {
          const selected = row.id === selectedId;
          const firstLine = row.note.split("\n")[0]?.trim();
          return (
            <li
              key={row.id}
              className={cn(
                "flex items-center gap-2 border-b border-dashed last:border-0",
                selected && "bg-primary-soft",
              )}
            >
              <button
                type="button"
                onClick={() => onPull(row)}
                aria-pressed={selected}
                title={t("pull")}
                className={cn(
                  "flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5 px-3.5 py-2 text-left text-sm transition-colors hover:bg-surface-2",
                  selected && "hover:bg-primary-soft",
                )}
              >
                <span className={cn("font-medium", selected && "text-primary")}>{row.name}</span>
                <span className="border border-border-strong px-1.5 py-px font-mono text-[12px]">
                  {row.plate}
                </span>
                {row.line && (
                  <span className="flex items-center gap-1 border border-ok/45 px-1.5 py-px text-[10px] text-ok">
                    <MessageCircle className="size-3" aria-hidden />
                    {t("lineMark")}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {firstLine || t("noNote")}
                </span>
                <span className="num flex-none text-[11px] text-faint">
                  {format.relativeTime(new Date(row.submittedAt))}
                </span>
              </button>
              <button
                type="button"
                disabled={dismissing === row.id}
                onClick={() => {
                  setDismissing(row.id);
                  void onDismiss(row).finally(() => setDismissing(null));
                }}
                aria-label={t("dismiss")}
                title={t("dismiss")}
                className="mr-2 flex-none border border-transparent p-1 text-faint transition-colors hover:border-bad/50 hover:text-bad disabled:opacity-50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
