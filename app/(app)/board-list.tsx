"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/blocks/brand-mark";
import type { BoardCase } from "@/lib/board";
import { BOARD_GROUPS, type BoardGroup } from "@/lib/case-flow";
import { formatBaht } from "@/lib/money";
import { formatPhone } from "@/lib/normalize";
import { cn } from "@/lib/utils";
import { AgeLabel, Pill } from "./board-pill";

/**
 * The list (D-26): one attention-ordered column. The D-2 groups survive as
 * quiet dividers carrying the group's money line; each row is brand mark ·
 * plate and car · contact · one pill · age · chevron. Selecting a row fills
 * the pane; the row itself never navigates — Open case does.
 */

const ROW_GRID =
  "grid-cols-[40px_minmax(0,1fr)_minmax(110px,150px)_minmax(150px,200px)_40px_16px]";

function groupMoney(group: BoardGroup, rows: BoardCase[]): { key: string; amount: number } | null {
  switch (group) {
    case "AWAITING_AUTH":
      return { key: "offered", amount: rows.reduce((sum, row) => sum + row.offerTotalSatang, 0) };
    case "READY":
      return { key: "collect", amount: rows.reduce((sum, row) => sum + row.balance.totalDueSatang, 0) };
    case "BALANCE_DUE":
      return { key: "outstanding", amount: rows.reduce((sum, row) => sum + row.balance.totalDueSatang, 0) };
    default:
      return null;
  }
}

export function BoardList({
  rows,
  now,
  selectedId,
  onSelect,
  emptyText,
}: {
  rows: BoardCase[];
  now: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyText: string;
}) {
  const t = useTranslations("board");

  if (rows.length === 0) {
    return <p className="px-6 py-14 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="px-3 pt-1 pb-3">
      {BOARD_GROUPS.map((group) => {
        const members = rows.filter((row) => row.stage === group);
        if (members.length === 0) return null;
        const money = groupMoney(group, members);
        return (
          <div key={group}>
            <div className="flex items-baseline gap-2 px-2.5 pt-3.5 pb-1.5 text-[11.5px] font-semibold text-muted-foreground">
              {t(`groups.${group}`)}
              <span className="num font-medium text-faint">{members.length}</span>
              {money && money.amount > 0 && (
                <span className="num ml-auto font-medium text-muted-foreground">
                  {t(`groupMoney.${money.key}`, { amount: formatBaht(money.amount) })}
                </span>
              )}
            </div>
            {members.map((row) => {
              const selected = row.id === selectedId;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelect(row.id)}
                  aria-pressed={selected}
                  className={cn(
                    "mb-1.5 grid w-full items-center gap-3.5 rounded-[12px] border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    ROW_GRID,
                    selected
                      ? "border-primary bg-primary/8 ring-3 ring-primary/15"
                      : "hover:border-border-strong hover:bg-surface-2/60",
                  )}
                >
                  <BrandMark make={row.make} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="num truncate text-[14px] font-semibold">{row.plate}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[[row.make, row.model].filter(Boolean).join(" "), row.reference].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[12.5px]">{row.contactName}</span>
                    <span className="num truncate text-[11px] text-faint">{formatPhone(row.contactPhone)}</span>
                  </span>
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <Pill pill={row.pill} />
                    {row.technicians.length > 0 && !row.needsMe && (
                      <span className="truncate pl-0.5 text-[11px] text-faint">{row.technicians.join(" · ")}</span>
                    )}
                  </span>
                  <AgeLabel
                    since={row.stage === "BALANCE_DUE" && row.deliveredAt ? row.deliveredAt : row.checkedInAt}
                    now={now}
                    tone={row.ageTone}
                    className="text-right"
                  />
                  <ChevronRight className="size-4 text-faint" aria-hidden />
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
