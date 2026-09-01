"use client";

import { Camera, Check, ClipboardCheck, Crosshair, Pencil, Plus, X } from "lucide-react";
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
  actionsFor,
  canConfirm,
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
  setFindingConfirmed,
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
  /**
   * The one Finding showing its form. Only one is open across the whole panel:
   * a zone with three findings keyed in was three identical forms, three
   * identical Accept blocks and the recorder line three times over, and
   * nothing in that stack said which row you were standing in. Everything a
   * form holds is already persisted, so collapsing one costs nothing.
   */
  const [openFindingId, setOpenFindingId] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    },
    [],
  );

  function flashError(code: InspectionError) {
    setError(code);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4000);
  }

  const markBusy = (key: string, on: boolean) => setBusy((b) => ({ ...b, [key]: on }));

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

  /**
   * A checklist item's Finding lives under the row that produced it (D-14),
   * so the checklist needs the whole Finding, not just its condition.
   */
  const checklistFindings = useMemo(() => {
    const map = new Map<string, FindingDto>();
    for (const f of findings) {
      if (f.checklistItem && f.condition) map.set(f.checklistItem, f);
    }
    return map;
  }, [findings]);

  const photoCount = findings.reduce((sum, f) => sum + f.photos.length, 0);
  const damageCount = findings.filter((f) => f.source === "DAMAGE_MAP").length;

  /**
   * Findings collected by the place they describe. A second dent on the hood
   * belongs under the first one, not at the bottom of the list — the zone is
   * the thing the advisor is looking at, and the entries are what they found
   * there. Map insertion order keeps each group where its first finding put
   * it, so accepting or adding never reshuffles the panel.
   */
  const findingGroups = useMemo(() => {
    const groups = new Map<string, FindingDto[]>();
    for (const f of findings) {
      if (f.source !== "DAMAGE_MAP") continue;
      const key = `zone:${f.zone}`;
      const existing = groups.get(key);
      if (existing) existing.push(f);
      else groups.set(key, [f]);
    }
    return [...groups].map(([key, members]) => ({ key, members }));
  }, [findings]);

  /* ---------- mutations ---------- */

  async function handleZoneTap(zone: ZoneId) {
    // Tapping the ringed zone again puts it down. Nothing else cleared it, so
    // the first zone touched stayed selected for the rest of the inspection.
    if (selectedZone === zone) {
      setSelectedZone(null);
      const open = findings.find((f) => f.id === openFindingId);
      if (open?.zone === zone) setOpenFindingId(null);
      return;
    }
    const existing = findings.filter((f) => f.zone === zone);
    setSelectedZone(zone);
    if (existing.length > 0) {
      // Coming back to a marked zone means finishing what is unfinished there.
      const unfinished = existing.find((f) => f.confirmedAt === null);
      if (unfinished) setOpenFindingId(unfinished.id);
      cardRefs.current
        .get(existing[0].id)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      setOpenFindingId(res.value.id);
      requestAnimationFrame(() =>
        cardRefs.current
          .get(res.value.id)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
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
    void mutateFinding(f.id, { damageTypes: next }, () =>
      updateFinding(f.id, { damageTypes: next }),
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
    void mutateFinding(f.id, { note: note.trim() || null }, () => updateFinding(f.id, { note }));
  }

  /**
   * The accept step. Nothing is saved here — every field persisted as it was
   * tapped — so this only flips the Finding between "being captured" and
   * "accepted as final", which is what decides whether it can be grouped
   * into a Job. Reopening puts the zone back under the map cursor.
   */
  async function handleConfirm(f: FindingDto, confirmed: boolean) {
    if (confirmed && !canConfirm(f)) return;
    // Accepting closes the zone out: the ring follows the work, not the history.
    if (confirmed) setSelectedZone(null);
    else if (f.zone) setSelectedZone(f.zone);
    setOpenFindingId(confirmed ? null : f.id);
    await mutateFinding(f.id, { confirmedAt: confirmed ? new Date().toISOString() : null }, () =>
      setFindingConfirmed(f.id, confirmed),
    );
  }

  async function handleRemove(f: FindingDto) {
    if (armedRemove !== f.id) {
      setArmedRemove(f.id);
      setTimeout(() => setArmedRemove((cur) => (cur === f.id ? null : cur)), 3000);
      return;
    }
    setArmedRemove(null);
    setOpenFindingId((id) => (id === f.id ? null : id));
    // Discarding a zone's last Finding leaves nothing to be looking at.
    if (f.zone && selectedZone === f.zone && !findings.some((x) => x.zone === f.zone && x.id !== f.id)) {
      setSelectedZone(null);
    }
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
      setOpenFindingId(res.value?.id ?? null);
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

  /**
   * One Finding's body, used by both capture surfaces: the Damage Map's zone
   * tiles and the Service Checklist's rows. A checklist item's Finding is
   * rendered under the row that produced it and never echoed in the damage
   * list, so nothing on this screen is printed twice (D-14).
   */
  function renderFindingEntry(
    f: FindingDto,
    {
      label,
      ordinal,
      separated,
      showCondition,
    }: {
      /** The place this Finding belongs to — a zone, or a checklist item. */
      label: string;
      /** Position within its group, or null where there is nothing to tell apart. */
      ordinal: number | null;
      separated: boolean;
      /** False under the checklist, whose tri-state already shows the condition. */
      showCondition: boolean;
    },
  ) {
    const isMap = f.source === "DAMAGE_MAP";
    const confirmed = f.confirmedAt !== null;
    // Once a Finding is on a Job it is the stated reason for work that may be
    // priced and authorized, and the server refuses to edit, un-accept or
    // delete it (assertUngrouped). Offering Edit and discard here would only
    // raise errors — the way back in is deleting the Job, on the case page.
    const grouped = f.jobId !== null;
    const open = !confirmed && !grouped && openFindingId === f.id;
    // The Job chip earns its place only when the Job is named something other
    // than the place itself: "Hood → Hood" is a coloured repeat of the word
    // sitting above it.
    const jobTitle = f.jobId ? (jobTitles[f.jobId] ?? "") : null;
    const jobChip = jobTitle !== null && jobTitle !== label && (
      <span
        className="max-w-40 shrink-0 truncate border border-ok/40 px-1.5 py-px text-[10.5px] text-ok"
        title={jobTitle}
      >
        {t("inJob", { title: jobTitle })}
      </span>
    );
    const ordinalEl = ordinal !== null && (
      <span className="num w-3 shrink-0 text-[10px] text-faint">{ordinal}</span>
    );
    // The row leads with whatever most distinguishes this Finding and demotes
    // the rest: two scratches on one panel differ by their note and their
    // photo and by nothing else. A draft with no action says so instead of
    // trailing off — that is the whole reason Accept is refusing it.
    const what = isMap
      ? f.damageTypes.map((d) => t(`damageTypes.${d}`)).join(", ")
      : showCondition && f.condition
        ? t(`conditions.${f.condition}`)
        : "";
    const willDo = f.proposedActions.map((a) => t(`actions.${a}`)).join(", ");
    // What still stands between this Finding and Accept, named in the row
    // instead of left blank — mirroring canConfirm, so a "due soon" wear item
    // is never told it is missing an action it does not need.
    const missing: string[] = [];
    if (isMap) {
      if (f.damageTypes.length === 0) missing.push(t("noDamageYet"));
      if (!willDo) missing.push(t("noActionYet"));
    } else if (f.condition === "NEEDS_WORK" && !willDo) {
      missing.push(t("noActionYet"));
    }
    const facts = [f.note, what, willDo].filter(Boolean) as string[];
    facts.push(...missing);
    // A watched wear item with no note has nothing else to say; it still says
    // that, rather than rendering a blank line under its checklist row.
    if (facts.length === 0) facts.push(t("noWorkProposed"));
    const lead = facts[0] ?? "";
    const trail = facts.slice(1).join(" · ");
    // Ordinal, state and Job sit on a quiet line above the choice bars, and only
    // when one of them exists — a checklist draft would otherwise open with an
    // empty row under its name. Discard lives with Accept in the footer: they
    // are the two ways a finding form ends, and keeping it out of the bars lets
    // both bars run the full width and line up with each other.
    const hasMeta = Boolean((showCondition && f.condition) || jobChip);
    const removeBtn = !readOnly && !grouped && (
      <button
        type="button"
        onClick={() => void handleRemove(f)}
        className={cn(
          "flex h-9 w-10 items-center justify-center border border-dashed transition-colors",
          armedRemove === f.id
            ? "border-bad bg-bad/15 text-bad"
            : "border-border-strong text-faint hover:border-bad hover:text-bad",
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
    );

    return (
      <div
        key={f.id}
        ref={(el) => {
          if (el) cardRefs.current.set(f.id, el);
          else cardRefs.current.delete(f.id);
        }}
        className={cn(separated && "border-t border-border-strong")}
      >
        {!open ? (
          /* Not the one being worked on: a record, not a form
           (D-7, D-11) — accepted or still a draft. */
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            {ordinalEl}
            {f.photos.length > 0 ? (
              <a
                href={`/api/photos/${f.photos[0].id}`}
                target="_blank"
                rel="noreferrer"
                className="relative shrink-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; next/image would re-fetch without the session cookie */}
                <img
                  src={`/api/photos/${f.photos[0].id}`}
                  alt={t("photoAlt", { n: 1 })}
                  className="h-8 w-10 border object-cover opacity-90 hover:opacity-100"
                  loading="lazy"
                />
                {f.photos.length > 1 && (
                  <span className="num absolute -right-1 -top-1 border bg-background px-1 text-[9px] leading-tight text-faint">
                    {f.photos.length}
                  </span>
                )}
              </a>
            ) : (
              <span
                aria-hidden
                className="flex h-8 w-10 shrink-0 items-center justify-center border border-dashed text-faint"
              >
                <Camera className="size-3.5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span
                className={cn("block truncate text-[11.5px]", !willDo && !trail && "text-warn/80")}
              >
                {lead}
              </span>
              {trail && (
                <span
                  className={cn(
                    "block truncate text-[10px]",
                    willDo ? "text-faint" : "text-warn/80",
                  )}
                >
                  {trail}
                </span>
              )}
            </span>
            {jobChip}
            {!readOnly && !grouped && (
              <button
                type="button"
                disabled={busy[f.id]}
                onClick={() => (confirmed ? void handleConfirm(f, false) : setOpenFindingId(f.id))}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-[11px]",
                  // Dashed and lit for unfinished work, quiet
                  // and solid for a record already closed out.
                  confirmed
                    ? "border-border-strong text-faint hover:border-primary-dim hover:text-primary"
                    : "border-dashed border-primary-dim text-primary hover:border-primary",
                )}
              >
                <Pencil className="size-3" aria-hidden />
                {confirmed ? t("reopen") : t("continueFinding")}
              </button>
            )}
          </div>
        ) : (
          /* Still being captured: the full form, ending in Accept. */
          <div className="flex flex-col gap-2 px-2.5 py-2">
            {hasMeta && (
              <div className="flex flex-wrap items-center gap-1.5">
                {showCondition && f.condition && (
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
                {jobChip}
              </div>
            )}

            {/* Two questions, each named and each answered in its own bar. The
              bars are drawn in `faint` rather than `border-strong`: at 11.5px
              the old outline sat at 1.6:1 against the tile and the unpicked
              labels at 3.4:1, so the choices read as already switched off. Cells
              share the row equally, which keeps the two bars aligned and every
              option the same size to hit. */}
            {isMap && (
              <div className="flex items-center gap-2">
                <span className="flex w-14 shrink-0 items-baseline gap-1 text-[10.5px] text-muted-foreground">
                  {ordinalEl}
                  {t("damageLabel")}
                </span>
                <div
                  role="group"
                  aria-label={t("damageLabel")}
                  className="flex min-w-0 flex-1 border border-faint"
                >
                  {DAMAGE_TYPES.map((type) => {
                    const on = f.damageTypes.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        disabled={readOnly || busy[f.id]}
                        onClick={() => toggleDamageType(f, type)}
                        className={cn(
                          "flex min-h-8 min-w-0 flex-1 items-center justify-center border-l border-faint px-1 py-1 text-center text-[11.5px] leading-tight transition-colors first:border-l-0",
                          on
                            ? "bg-warn/15 text-warn"
                            : "text-muted-foreground hover:bg-raise hover:text-foreground",
                        )}
                        aria-pressed={on}
                      >
                        {t(`damageTypes.${type}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[10.5px] text-muted-foreground">{t("fixLabel")}</span>
              <div
                role="group"
                aria-label={t("fixLabel")}
                className="flex min-w-0 flex-1 border border-faint"
              >
                {actionsFor(f.source).map((action) => {
                  const on = f.proposedActions.includes(action);
                  return (
                    <button
                      key={action}
                      type="button"
                      disabled={readOnly || busy[f.id]}
                      onClick={() => toggleAction(f, action)}
                      className={cn(
                        "flex min-h-8 min-w-0 flex-1 items-center justify-center border-l border-faint px-1 py-1 text-center text-[11.5px] leading-tight transition-colors first:border-l-0",
                        on
                          ? "bg-primary-soft text-primary"
                          : "text-muted-foreground hover:bg-raise hover:text-foreground",
                      )}
                      aria-pressed={on}
                    >
                      {t(`actions.${action}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            <textarea
              defaultValue={f.note ?? ""}
              placeholder={t("notePlaceholder")}
              readOnly={readOnly}
              rows={1}
              onBlur={(e) => saveNote(f, e.currentTarget.value)}
              className="min-h-8 w-full resize-y border border-dashed bg-transparent px-2.5 py-1.5 text-xs placeholder:text-faint focus:border-primary focus:outline-none"
            />

            {f.photos.length > 0 && (
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
              </div>
            )}

            {/* Meta line carries the card's affordances so an
              unphotographed finding does not spend a whole
              row on an empty camera tile. Accept is the one
              filled control on the screen — every other
              chip and button is an outline, so weight alone
              says which one closes the finding out. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate text-[10.5px] text-faint">
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
              {!readOnly && (
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {removeBtn}
                  <label
                    className={cn(
                      "flex h-9 w-10 cursor-pointer items-center justify-center border border-dashed text-primary hover:border-primary",
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
                  <button
                    type="button"
                    disabled={!canConfirm(f) || busy[f.id]}
                    onClick={() => void handleConfirm(f, true)}
                    title={canConfirm(f) ? t("accept") : missing.join(" · ")}
                    className={cn(
                      "flex h-9 items-center gap-1.5 border px-3.5 text-[12px] font-semibold transition-colors",
                      canConfirm(f)
                        ? "border-primary bg-primary text-primary-foreground hover:bg-primary/85 active:translate-y-px"
                        : "border-dashed border-border-strong text-faint",
                    )}
                  >
                    <Check className="size-4" aria-hidden />
                    {t("accept")}
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
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
              {damageCount}
            </span>
          </header>

          {damageCount === 0 ? (
            <p className="px-3.5 py-4 text-xs text-faint">{t("empty")}</p>
          ) : (
            <ul className="flex flex-col gap-2 p-2">
              {findingGroups.map(({ key, members }) => {
                const first = members[0];
                const label = t(`zones.${first.zone}` as never);
                const selected = selectedZone != null && first.zone === selectedZone;
                // The tile wears the worst severity among its members, the
                // same way the zone's marking on the map does.
                const severity = members.some((m) => findingSeverity(m) === "SEVERE")
                  ? "SEVERE"
                  : "MINOR";
                const numbered = members.length > 1;
                return (
                  <li
                    key={key}
                    className={cn(
                      // One zone, one tile, raised off the panel with real air
                      // between tiles. A second dent on the hood then reads as
                      // another line of the same place rather than a new
                      // finding — hairlines alone never carried that on black.
                      "relative border",
                      selected ? "border-primary bg-primary-soft" : "bg-surface-2",
                    )}
                  >
                    {/* Severity is a painted edge rather than a border colour:
                        a selected tile's border is already primary, and the bar
                        keeps both signals readable at once (D-3 palette). */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 left-0 w-0.5",
                        severity === "SEVERE" ? "bg-bad/70" : "bg-warn/55",
                      )}
                    />

                    <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
                      <button
                        type="button"
                        className="text-[13px] font-semibold hover:text-primary"
                        onClick={() => first.zone && setSelectedZone(first.zone)}
                      >
                        {label}
                      </button>
                      {numbered && (
                        <span className="num ml-auto text-[10px] text-faint">
                          {t("entryCount", { count: members.length })}
                        </span>
                      )}
                    </div>

                    {members.map((f, index) =>
                      renderFindingEntry(f, {
                        label,
                        ordinal: numbered ? index + 1 : null,
                        separated: index > 0,
                        showCondition: true,
                      }),
                    )}

                    {selected && !readOnly && (
                      <div className="flex justify-end border-t border-dashed px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={() => first.zone && void createOnZone(first.zone)}
                          className="flex h-8 items-center gap-1 border border-border-strong px-2 text-[10.5px] text-faint hover:border-primary-dim hover:text-primary"
                        >
                          <Plus className="size-3" aria-hidden />
                          {t("addAnother")}
                        </button>
                      </div>
                    )}
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
            <span className="num ml-auto border border-border-strong px-1.5 text-[10.5px] text-primary">
              {checklistFindings.size}
            </span>
          </header>
          <ul>
            {CHECKLIST_ITEMS.map((item) => {
              const finding = checklistFindings.get(item);
              const state = finding?.condition;
              // Accepted means accepted here too (D-11). A live tri-state over
              // a closed record let one stray tap rewrite the condition without
              // passing the gate — and "OK" deletes the Finding and its photos
              // outright, with none of the damage side's arm-then-confirm. The
              // Edit control on the record beneath is the way back in.
              const locked = finding != null && (finding.confirmedAt != null || finding.jobId != null);
              const itemLabel = t(`checklist.${item}` as never);
              const options = [
                {
                  key: "OK" as const,
                  label: t("checklistStates.ok"),
                  cls: "bg-ok/15 text-ok",
                },
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
                <li key={item} className="border-b last:border-b-0">
                  <div className="flex items-center gap-2.5 px-3.5 py-2">
                    <span className="min-w-0 flex-1 text-[13px]">{itemLabel}</span>
                    <span
                      className={cn("flex border", locked ? "border-border-strong" : "border-faint")}
                      title={
                        finding?.jobId
                          ? t("checklistGrouped")
                          : locked
                            ? t("checklistLocked")
                            : undefined
                      }
                    >
                      {options.map((option) => {
                        const on = (state ?? "OK") === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            disabled={readOnly || locked || busy[`cl:${item}`]}
                            onClick={() => void handleChecklist(item, option.key)}
                            className={cn(
                              "flex h-8 items-center border-l px-3 text-[11px] transition-colors first:border-l-0",
                              locked ? "border-border-strong" : "border-faint",
                              on
                                ? option.cls
                                : locked
                                  ? "text-faint"
                                  : "text-muted-foreground hover:bg-raise hover:text-foreground",
                            )}
                            aria-pressed={on}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                  {/* The Finding this row produced, kept under the row that
                      produced it: it still has to be a Finding to reach a Job,
                      but it has no business appearing a second time in the
                      damage list (D-14). The tri-state above already states the
                      condition, so the entry never repeats it. */}
                  {finding &&
                    renderFindingEntry(finding, {
                      label: itemLabel,
                      ordinal: null,
                      separated: true,
                      showCondition: false,
                    })}
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
            <span
              role="alert"
              className="ml-auto border border-bad/45 px-2 py-0.5 text-[11px] text-bad"
            >
              {t(`errors.${error}`)}
            </span>
          )}
        </section>
      </div>
    </div>
  );
}
