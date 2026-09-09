"use client";

import { ChevronDown, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  matchesSearch,
  SEGMENT_STAGES,
  spineSummary,
  type BoardCase,
  type SpineSegment,
} from "@/lib/board";
import { cn } from "@/lib/utils";
import { BoardList } from "./board-list";
import { BoardPane } from "./board-pane";
import { BoardSpine } from "./board-spine";

/**
 * The board's client shell (D-26): filter, search, segment, and selection
 * live here; the rows arrive derived and sorted from the server. Needs me is
 * the default because the advisor is the board's first reader; the spine
 * segment narrows either filter; search narrows everything.
 */
export function BoardView({ rows, now }: { rows: BoardCase[]; now: string }) {
  const t = useTranslations("board");
  const [filter, setFilter] = useState<"mine" | "all">("mine");
  const [segment, setSegment] = useState<SpineSegment | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useMemo(() => spineSummary(rows), [rows]);
  const needsMe = rows.filter((row) => row.needsMe).length;

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          (filter === "all" || row.needsMe) &&
          (segment === null || SEGMENT_STAGES[segment].includes(row.stage)) &&
          matchesSearch(row, query),
      ),
    [rows, filter, segment, query],
  );

  const selected = visible.find((row) => row.id === selectedId) ?? visible[0] ?? rows[0]!;

  const emptyText = query.trim()
    ? t("noMatch", { query: query.trim() })
    : filter === "mine"
      ? t("emptyNeedsMe")
      : t("emptySegment");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="h-9 w-[300px] rounded-[10px] border bg-card pr-3 pl-9 text-[13px] placeholder:text-faint focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </label>
        <Link
          href="/checkin"
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 active:translate-y-px"
        >
          <Plus className="size-4" aria-hidden />
          {t("newCheckin")}
        </Link>
      </div>

      <BoardSpine summary={summary} active={segment} onSelect={setSegment} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="rounded-[14px] border bg-card lift">
          <header className="flex items-center gap-3 border-b px-5 py-3.5">
            <h2 className="text-base font-semibold">{t("title")}</h2>
            <span className="text-xs text-muted-foreground">{t("carsInShop", { count: rows.length })}</span>
            <div className="ml-auto inline-flex rounded-[9px] border bg-surface-2 p-[3px]" role="tablist">
              {(["mine", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    "rounded-[7px] px-3 py-1 text-xs font-medium transition-colors",
                    filter === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {value === "mine" ? t("needsMe") : t("all")}
                  <span className={cn("num ml-1.5 font-semibold", filter === value ? "text-primary" : "text-faint")}>
                    {value === "mine" ? needsMe : rows.length}
                  </span>
                </button>
              ))}
            </div>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {t("oldestFirst")}
              <ChevronDown className="size-3.5" aria-hidden />
            </span>
          </header>
          <BoardList rows={visible} now={now} selectedId={selected.id} onSelect={setSelectedId} emptyText={emptyText} />
        </section>
        <BoardPane row={selected} />
      </div>
    </div>
  );
}
