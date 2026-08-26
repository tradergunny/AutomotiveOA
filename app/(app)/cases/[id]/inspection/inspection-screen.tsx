"use client";

import { Camera, ClipboardCheck, Crosshair, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { DamageMap, DamageMapCompact } from "@/components/blocks/damage-map/damage-map";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { downscalePhoto } from "@/lib/downscale";
import type { BodyType, FindingCondition } from "@/lib/generated/prisma/enums";
import {
  CHECKLIST_ITEMS,
  DAMAGE_TYPES,
  PROPOSED_ACTIONS,
  findingSeverity,
  type FindingDto,
  type ZoneId,
} from "@/lib/inspection";
import { cn } from "@/lib/utils";
import {
  addFindingPhoto,
  createMapFinding,
  removeFinding,
  removeFindingPhoto,
  setChecklistState,
  updateFinding,
  type InspectionError,
} from "./actions";

/**
 * Client half of the Inspection screen (M3 brief §3–5): Damage Map left,
 * Findings + Service Checklist right. Every capture persists immediately;
 * this component holds the findings as state and reconciles with what each
 * server action returns.
 */

type Props = {
  caseId: string;
  bodyType: BodyType;
  initialFindings: FindingDto[];
  /** Job id → title, for the "→ grouped into" chip (M4). */
  jobTitles: Record<string, string>;
  readOnly: boolean;
};

export function InspectionScreen({
  caseId,
  bodyType,
  initialFindings,
  jobTitles,
  readOnly,
}: Props) {
  const t = useTranslations("inspection");
  const format = useFormatter();
  const [findings, setFindings] = useState(initialFindings);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<InspectionError | null>(null);
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  function flashError(code: InspectionError) {
    setError(code);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4000);
  }

  const markBusy = (key: string, on: boolean) =>
    setBusy((b) => ({ ...b, [key]: on }));

  /* ---------- derived ---------- */

  const markings = useMemo(() => {
    const map = new Map<string, { count: number; severity: "MINOR" | "SEVERE" }>();
    for (const f of findings) {
      if (!f.zone) continue;
      const severity = findingSeverity(f);
      const prev = map.get(f.zone);
      map.set(f.zone, {
        count: (prev?.count ?? 0) + 1,
        severity: prev?.severity === "SEVERE" ? "SEVERE" : severity,
      });
    }
    return map;
  }, [findings]);

  const checklistState = useMemo(() => {
    const map = new Map<string, FindingCondition>();
    for (const f of findings) {
      if (f.checklistItem && f.condition) map.set(f.checklistItem, f.condition);
    }
    return map;
  }, [findings]);

  const photoCount = findings.reduce((sum, f) => sum + f.photos.length, 0);

  /* ---------- mutations ---------- */

  async function handleZoneTap(zone: ZoneId) {
    const existing = findings.filter((f) => f.zone === zone);
    setSelectedZone(zone);
    if (existing.length > 0) {
      cardRefs.current.get(existing[0].id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    await createOnZone(zone);
  }

  async function createOnZone(zone: string) {
    if (busy[`zone:${zone}`]) return;
    markBusy(`zone:${zone}`, true);
    try {
      const res = await createMapFinding(caseId, zone);
      if (!res.ok) return flashError(res.error);
      setFindings((fs) => [...fs, res.value]);
      requestAnimationFrame(() =>
        cardRefs.current.get(res.value.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      );
    } finally {
      markBusy(`zone:${zone}`, false);
    }
  }

  async function mutateFinding(
    id: string,
    local: Partial<FindingDto>,
    run: () => Promise<Awaited<ReturnType<typeof updateFinding>>>,
  ) {
    const prev = findings;
    setFindings((fs) => fs.map((f) => (f.id === id ? { ...f, ...local } : f)));
    markBusy(id, true);
    try {
      const res = await run();
      if (!res.ok) {
        setFindings(prev);
        return flashError(res.error);
      }
      setFindings((fs) => fs.map((f) => (f.id === id ? res.value : f)));
    } finally {
      markBusy(id, false);
    }
  }

  function toggleDamageType(f: FindingDto, type: (typeof DAMAGE_TYPES)[number]) {
    const next = f.damageTypes.includes(type)
      ? f.damageTypes.filter((d) => d !== type)
      : [...f.damageTypes, type];
    const safe = next.length ? next : ["SCRATCH" as const];
    void mutateFinding(f.id, { damageTypes: safe }, () =>
      updateFinding(f.id, { damageTypes: safe }),
    );
  }

  function toggleAction(f: FindingDto, action: (typeof PROPOSED_ACTIONS)[number]) {
    const next = f.proposedActions.includes(action)
      ? f.proposedActions.filter((a) => a !== action)
      : [...f.proposedActions, action];
    void mutateFinding(f.id, { proposedActions: next }, () =>
      updateFinding(f.id, { proposedActions: next }),
    );
  }

  function saveNote(f: FindingDto, note: string) {
    if ((f.note ?? "") === note.trim()) return;
    void mutateFinding(f.id, { note: note.trim() || null }, () =>
      updateFinding(f.id, { note }),
    );
  }

  async function handleRemove(f: FindingDto) {
    if (armedRemove !== f.id) {
      setArmedRemove(f.id);
      setTimeout(() => setArmedRemove((cur) => (cur === f.id ? null : cur)), 3000);
      return;
    }
    setArmedRemove(null);
    const prev = findings;
    setFindings((fs) => fs.filter((x) => x.id !== f.id));
    const res = await removeFinding(f.id);
    if (!res.ok) {
      setFindings(prev);
      flashError(res.error);
    }
  }

  async function handleChecklist(item: string, state: "OK" | FindingCondition) {
    if (busy[`cl:${item}`]) return;
    markBusy(`cl:${item}`, true);
    try {
      const res = await setChecklistState(caseId, item, state);
      if (!res.ok) return flashError(res.error);
      setFindings((fs) => {
        const rest = fs.filter((f) => f.checklistItem !== item);
        return res.value ? [...rest, res.value] : rest;
      });
    } finally {
      markBusy(`cl:${item}`, false);
    }
  }

  async function handleAddPhotos(f: FindingDto, list: FileList | null) {
    if (!list?.length) return;
    markBusy(`photo:${f.id}`, true);
    try {
      for (const file of Array.from(list)) {
        const blob = await downscalePhoto(file);
        const formData = new FormData();
        formData.append("photo", blob, "finding.jpg");
        const res = await addFindingPhoto(f.id, formData);
        if (!res.ok) {
          flashError(res.error);
          break;
        }
        setFindings((fs) => fs.map((x) => (x.id === f.id ? res.value : x)));
      }
    } finally {
      markBusy(`photo:${f.id}`, false);
    }
  }

  async function handleRemovePhoto(f: FindingDto, photoId: string) {
    const res = await removeFindingPhoto(photoId);
    if (!res.ok) return flashError(res.error);
    setFindings((fs) => fs.map((x) => (x.id === f.id ? res.value : x)));
  }

  /* ---------- render ---------- */

  const legendSwatch = "inline-block size-3 w-4 border align-[-1px]";

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
      {/* damage map card */}
      <section className="relative border bg-card">
        <CornerTicks />
        <header className="flex items-center gap-2.5 border-b border-dashed px-3.5 py-2.5">
          <Crosshair className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-[12.5px] font-semibold tracking-wide">{t("mapTitle")}</h2>
          <span className="border border-border-strong px-1.5 font-mono text-[10.5px] text-primary">
            {t("mapTag")}
          </span>
        </header>
        <p className="px-3.5 pt-2 text-[11.5px] text-faint">
          {readOnly ? t("deliveredLocked") : t("mapHint")}
        </p>
        <div className="dm-area px-2.5 pb-3 pt-1.5">
          <div className="hidden md:block">
            <DamageMap
              bodyType={bodyType}
              markings={markings}
              selectedZone={selectedZone}
              onZoneTap={handleZoneTap}
              disabled={readOnly}
            />
          </div>
          <div className="md:hidden">
            <DamageMapCompact
              bodyType={bodyType}
              markings={markings}
              selectedZone={selectedZone}
              onZoneTap={handleZoneTap}
              disabled={readOnly}
            />
          </div>
        </div>
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-dashed px-3.5 py-2 text-[11px] text-faint">
          <span>
            <span className={cn(legendSwatch, "hatch mr-1.5 border-warn/50 text-warn")} />
            {t("legendMinor")}
          </span>
          <span>
            <span className={cn(legendSwatch, "hatch mr-1.5 border-bad/50 text-bad")} />
            {t("legendSevere")}
          </span>
          <span>
            <span className={cn(legendSwatch, "mr-1.5 border-primary bg-primary-soft")} />
            {t("legendSelected")}
          </span>
          <span>
            <span className={cn(legendSwatch, "mr-1.5 border-border-strong")} />
            {t("legendOk")}
          </span>
        </footer>
      </section>

      {/* findings + checklist column */}
      <div className="flex min-w-0 flex-col gap-4">
        <section className="relative border bg-card">
          <CornerTicks />
          <header className="flex items-center gap-2.5 border-b border-dashed px-3.5 py-2.5">
            <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-[12.5px] font-semibold tracking-wide">{t("findingsTitle")}</h2>
            <span className="num ml-auto border border-border-strong px-1.5 text-[10.5px] text-primary">
              {findings.length}
            </span>
          </header>

          {findings.length === 0 ? (
            <p className="px-3.5 py-4 text-xs text-faint">{t("empty")}</p>
          ) : (
            <ul>
              {findings.map((f) => {
                const isMap = f.source === "DAMAGE_MAP";
                const label = isMap
                  ? t(`zones.${f.zone}` as never)
                  : t(`checklist.${f.checklistItem}` as never)
                const selected = isMap && selectedZone != null && f.zone === selectedZone;
                return (
                  <li
                    key={f.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(f.id, el);
                      else cardRefs.current.delete(f.id);
                    }}
                    className={cn(
                      "flex flex-col gap-2 border-b px-3.5 py-3 last:border-b-0",
                      selected && "bg-primary-soft/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-[13px] font-semibold hover:text-primary"
                        onClick={() => isMap && f.zone && setSelectedZone(f.zone)}
                      >
                        {label}
                      </button>
                      <span className="border border-dashed border-border-strong px-1.5 py-px font-mono text-[9px] tracking-wider text-faint">
                        {isMap ? t("sourceMap") : t("sourceChecklist")}
                      </span>
                      {f.condition && (
                        <span
                          className={cn(
                            "hatch-soft border px-1.5 py-px text-[10.5px]",
                            f.condition === "NEEDS_WORK"
                              ? "border-bad/45 text-bad"
                              : "border-warn/45 text-warn",
                          )}
                        >
                          {t(`conditions.${f.condition}`)}
                        </span>
                      )}
                      {f.jobId ? (
                        <span
                          className="max-w-40 truncate border border-ok/40 px-1.5 py-px text-[10.5px] text-ok"
                          title={jobTitles[f.jobId]}
                        >
                          {t("inJob", { title: jobTitles[f.jobId] ?? "" })}
                        </span>
                      ) : (
                        !readOnly && (
                          <Link
                            href={`/cases/${caseId}?group-finding=${f.id}#jobs`}
                            className="border border-border-strong px-1.5 py-px text-[10.5px] text-faint hover:border-primary-dim hover:text-primary"
                          >
                            {t("groupIntoJob")}
                          </Link>
                        )
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => void handleRemove(f)}
                          className={cn(
                            "ml-auto px-1 text-[15px] leading-none",
                            armedRemove === f.id
                              ? "bg-bad/15 text-bad"
                              : "text-faint hover:text-bad",
                          )}
                          aria-label={t("removeFinding")}
                          title={
                            armedRemove === f.id
                              ? t("removeFindingConfirm", { count: f.photos.length })
                              : t("removeFinding")
                          }
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </div>

                    {isMap && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {DAMAGE_TYPES.map((type) => {
                          const on = f.damageTypes.includes(type);
                          return (
                            <button
                              key={type}
                              type="button"
                              disabled={readOnly || busy[f.id]}
                              onClick={() => toggleDamageType(f, type)}
                              className={cn(
                                "border px-2 py-0.5 text-[11px] transition-colors",
                                on
                                  ? "hatch-soft border-warn/50 text-warn"
                                  : "border-border-strong text-faint hover:text-foreground",
                              )}
                              aria-pressed={on}
                            >
                              {t(`damageTypes.${type}`)}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5">
                      {PROPOSED_ACTIONS.map((action) => {
                        const on = f.proposedActions.includes(action);
                        return (
                          <button
                            key={action}
                            type="button"
                            disabled={readOnly || busy[f.id]}
                            onClick={() => toggleAction(f, action)}
                            className={cn(
                              "border px-2 py-0.5 text-[11px] transition-colors",
                              on
                                ? "border-primary-dim bg-primary-soft text-primary"
                                : "border-border-strong text-faint hover:text-foreground",
                            )}
                            aria-pressed={on}
                          >
                            {t(`actions.${action}`)}
                          </button>
                        );
                      })}
                    </div>

                    <textarea
                      defaultValue={f.note ?? ""}
                      placeholder={t("notePlaceholder")}
                      readOnly={readOnly}
                      rows={1}
                      onBlur={(e) => saveNote(f, e.currentTarget.value)}
                      className="w-full resize-y border border-dashed bg-transparent px-2 py-1 text-xs placeholder:text-faint focus:border-primary focus:outline-none"
                    />

                    <div className="flex flex-wrap items-center gap-1.5">
                      {f.photos.map((photo, i) => (
                        <span key={photo.id} className="group relative">
                          <a href={`/api/photos/${photo.id}`} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; next/image would re-fetch without the session cookie */}
                            <img
                              src={`/api/photos/${photo.id}`}
                              alt={t("photoAlt", { n: i + 1 })}
                              className="h-11 w-14 border object-cover opacity-90 group-hover:opacity-100"
                              loading="lazy"
                            />
                          </a>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => void handleRemovePhoto(f, photo.id)}
                              className="absolute -right-1.5 -top-1.5 hidden size-4 items-center justify-center border bg-background text-[10px] text-faint hover:text-bad group-hover:flex"
                              aria-label={t("removePhoto")}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {!readOnly && (
                        <label
                          className={cn(
                            "flex h-11 w-14 cursor-pointer items-center justify-center border border-dashed text-primary hover:border-primary",
                            busy[`photo:${f.id}`] && "animate-pulse",
                          )}
                          title={t("addPhoto")}
                        >
                          <Camera className="size-4" aria-hidden />
                          <span className="sr-only">{t("addPhoto")}</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="sr-only"
                            disabled={busy[`photo:${f.id}`]}
                            onChange={(e) => {
                              void handleAddPhotos(f, e.currentTarget.files);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] text-faint">
                        {t("recordedBy", {
                          when: format.dateTime(new Date(f.recordedAt), {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                          name: f.recordedByName,
                        })}
                      </span>
                      {!readOnly && selected && (
                        <button
                          type="button"
                          onClick={() => f.zone && void createOnZone(f.zone)}
                          className="ml-auto flex items-center gap-1 border border-border-strong px-1.5 py-0.5 text-[10.5px] text-faint hover:border-primary-dim hover:text-primary"
                        >
                          <Plus className="size-3" aria-hidden />
                          {t("addAnother")}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* service checklist */}
        <section className="border bg-card">
          <header className="flex items-center gap-2.5 border-b border-dashed px-3.5 py-2.5">
            <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-[12.5px] font-semibold tracking-wide">{t("checklistTitle")}</h2>
            <span className="border border-border-strong px-1.5 font-mono text-[10.5px] text-primary">
              {t("checklistTag")}
            </span>
          </header>
          <ul>
            {CHECKLIST_ITEMS.map((item) => {
              const state = checklistState.get(item);
              const options = [
                { key: "OK" as const, label: t("checklistStates.ok"), cls: "bg-ok/15 text-ok" },
                {
                  key: "DUE_SOON" as const,
                  label: t("checklistStates.dueSoon"),
                  cls: "bg-warn/15 text-warn",
                },
                {
                  key: "NEEDS_WORK" as const,
                  label: t("checklistStates.needsWork"),
                  cls: "bg-bad/15 text-bad",
                },
              ];
              return (
                <li key={item} className="flex items-center gap-2.5 border-b px-3.5 py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 text-[13px]">{t(`checklist.${item}`)}</span>
                  <span className="flex border border-border-strong">
                    {options.map((option) => {
                      const on = (state ?? "OK") === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          disabled={readOnly || busy[`cl:${item}`]}
                          onClick={() => void handleChecklist(item, option.key)}
                          className={cn(
                            "border-l border-border-strong px-2 py-0.5 text-[10.5px] first:border-l-0",
                            on ? option.cls : "text-faint hover:text-foreground",
                          )}
                          aria-pressed={on}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* summary bar */}
        <section className="flex items-center gap-3 border bg-card px-3.5 py-2.5">
          <span className="text-xs text-muted-foreground">
            {t("summary", { findings: findings.length, photos: photoCount })}
          </span>
          {error && (
            <span role="alert" className="ml-auto border border-bad/45 px-2 py-0.5 text-[11px] text-bad">
              {t(`errors.${error}`)}
            </span>
          )}
        </section>
      </div>
    </div>
  );
}
