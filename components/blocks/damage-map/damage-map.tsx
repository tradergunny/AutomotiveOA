"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { BodyType } from "@/lib/generated/prisma/enums";
import type { Severity, ZoneId } from "@/lib/inspection";
import { cn } from "@/lib/utils";
import { damageMapGeometry, SHEET, type ViewGeometry, type ViewId } from "./geometry";

/**
 * The Damage Map (M3): one unfolded five-view sheet, all exterior zones
 * tappable. Marked zones show a severity hatch + a per-zone finding-count
 * badge (DESIGN.md). Purely presentational — findings state lives in the
 * inspection screen, which passes `markings` and receives `onZoneTap`.
 */

export type ZoneMarking = { count: number; severity: Severity };

type DamageMapProps = {
  bodyType: BodyType;
  /** zone id → marking; unmarked zones render plain. */
  markings: ReadonlyMap<string, ZoneMarking>;
  /** Zone whose finding is open in the editor — held highlighted. */
  selectedZone?: string | null;
  onZoneTap?: (zone: ZoneId) => void;
  /** Delivered case: render inert (no tab stops, no pointer). */
  disabled?: boolean;
  /** Render just one view, viewBox-fitted (compact/expanded mode). */
  view?: ViewId;
};

const VIEW_ORDER: readonly ViewId[] = ["top", "front", "rear", "left", "right"];

export function DamageMap({
  bodyType,
  markings,
  selectedZone,
  onZoneTap,
  disabled,
  view,
}: DamageMapProps) {
  const t = useTranslations("inspection");
  const pid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const views = useMemo(() => damageMapGeometry(bodyType), [bodyType]);
  const shown = view ? views.filter((v) => v.id === view) : views;
  const viewBox = view
    ? `${shown[0].bounds.x} ${shown[0].bounds.y} ${shown[0].bounds.w} ${shown[0].bounds.h}`
    : `0 0 ${SHEET.width} ${SHEET.height}`;

  const hatch = (kind: "minor" | "severe", color: string) => (
    <pattern
      id={`dm${pid}-${kind}`}
      width="6"
      height="6"
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(-45)"
    >
      <rect
        width="6"
        height="6"
        style={{ fill: `color-mix(in srgb, ${color} 9%, transparent)` }}
      />
      <line
        x1="0"
        y1="0"
        x2="0"
        y2="6"
        strokeWidth="1.4"
        style={{ stroke: `color-mix(in srgb, ${color} 55%, transparent)` }}
      />
    </pattern>
  );

  return (
    <svg
      viewBox={viewBox}
      role="group"
      aria-label={t("mapAria")}
      className={cn("dm block h-auto w-full", disabled && "dm-disabled")}
    >
      <defs>
        {hatch("minor", "var(--warn)")}
        {hatch("severe", "var(--bad)")}
      </defs>

      {shown.map((v) => (
        <g key={v.id} transform={v.transform || undefined}>
          {v.decor.map((d, i) => (
            <path key={`d${i}`} className="dm-decor" d={d} />
          ))}
          {v.decorSoft.map((d, i) => (
            <path key={`s${i}`} className="dm-decor dm-soft" d={d} />
          ))}
          {v.zones.map((z) => {
            const marking = markings.get(z.zone);
            const label = t(`zones.${z.zone}`);
            const tap = () => onZoneTap?.(z.zone);
            return (
              <path
                key={z.zone}
                d={z.d}
                className={cn(
                  "dm-zone",
                  marking && (marking.severity === "SEVERE" ? "dm-severe" : "dm-minor"),
                  selectedZone === z.zone && "dm-selected",
                )}
                style={
                  marking
                    ? {
                        fill: `url(#dm${pid}-${marking.severity === "SEVERE" ? "severe" : "minor"})`,
                      }
                    : undefined
                }
                role="button"
                aria-label={label}
                aria-pressed={!!marking}
                tabIndex={disabled ? -1 : 0}
                onClick={disabled ? undefined : tap}
                onKeyDown={
                  disabled
                    ? undefined
                    : (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          tap();
                        }
                      }
                }
              >
                <title>{label}</title>
              </path>
            );
          })}
        </g>
      ))}

      {/* view captions */}
      {shown.map((v) =>
        view ? null : (
          <text key={`c-${v.id}`} className="dm-cap" x={v.caption[0]} y={v.caption[1]} textAnchor="middle">
            {t(`views.${v.id}`)}
          </text>
        ),
      )}

      {/* count badges — root coordinates, above everything, never hit targets */}
      {shown.map((v) => (
        <g key={`b-${v.id}`} pointerEvents="none">
          {v.zones
            .filter((z) => markings.has(z.zone))
            .map((z) => {
              const m = markings.get(z.zone)!;
              const [bx, by] = v.mapPoint(z.anchor);
              return (
                <g
                  key={`b-${z.zone}`}
                  className={cn("dm-badge", m.severity === "SEVERE" ? "dm-severe" : "dm-minor")}
                >
                  <circle cx={bx} cy={by} r="9" />
                  <text x={bx} y={by + 0.5}>
                    {m.count}
                  </text>
                </g>
              );
            })}
        </g>
      ))}
    </svg>
  );
}

/**
 * Small-screen variant (DESIGN.md: tap-to-expand a single view): a segmented
 * view picker above one large view. Pinch-zoom stays native via touch-action
 * on the wrapper.
 */
export function DamageMapCompact(props: Omit<DamageMapProps, "view">) {
  const t = useTranslations("inspection");
  const [view, setView] = useState<ViewId>("top");
  return (
    <div className="flex flex-col gap-2" style={{ touchAction: "pinch-zoom" }}>
      <div className="flex border border-border-strong" role="tablist" aria-label={t("expandView")}>
        {VIEW_ORDER.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cn(
              "flex-1 border-l border-border-strong px-1 py-1.5 font-mono text-[10px] tracking-widest first:border-l-0",
              view === v ? "bg-raise text-primary" : "text-faint hover:text-foreground",
            )}
          >
            {t(`views.${v}`)}
          </button>
        ))}
      </div>
      <DamageMap {...props} view={view} />
    </div>
  );
}

export type { ViewGeometry, ViewId };
