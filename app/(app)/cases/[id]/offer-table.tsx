"use client";

import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  Merge,
  Pencil,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Segmented } from "@/components/blocks/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downscalePhoto } from "@/lib/downscale";
import {
  offerParts,
  partKey,
  partOf,
  samePart,
  type JobDto,
} from "@/lib/jobs";
import { formatBaht, satangToBahtInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  addJobPhoto,
  deleteJob,
  mergeJobs,
  removeJobPhoto,
  updateJob,
  updateJobPrice,
  type JobError,
} from "./job-actions";
import { PartsTable, partsCostSatang, selectCls } from "./parts-table";
import { JobEvidence } from "./job-evidence";

/** Compact, payer-grouped repair review. Editing and merge tools are disclosed on demand. */

type Props = {
  caseId: string;
  jobs: JobDto[]; // PROPOSED only, oldest first
  staffOptions: { id: string; name: string }[];
  isManager: boolean;
  readOnly: boolean;
  /** Bumped by the header's Set prices: scroll here and focus the first empty cell. */
  focusNonce: number;
  onChanged: (dto: JobDto) => void;
  onDeleted: (jobId: string) => void;
  onMerged: (survivor: JobDto, absorbedIds: string[]) => void;
};

type Result = { ok: true; value: JobDto } | { ok: false; error: JobError };

export function OfferTable({
  caseId,
  jobs,
  staffOptions,
  isManager,
  readOnly,
  focusNonce,
  onChanged,
  onDeleted,
  onMerged,
}: Props) {
  const t = useTranslations("jobs");
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<JobError | null>(null);
  const priceRefs = useRef(new Map<string, HTMLInputElement>());
  const rootRef = useRef<HTMLDivElement>(null);

  const parts = offerParts(jobs);
  const mergeable = mergeMode && !readOnly && jobs.length >= 2;

  // The header's Set prices lands on the first empty live cell (D-21).
  useEffect(() => {
    if (focusNonce === 0) return;
    const target = jobs.find(
      (job) => job.priceSatang == null && (!job.catalogItemId || isManager),
    );
    const input = target ? priceRefs.current.get(target.id) : null;
    if (input) {
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      input.focus();
    } else {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // jobs/isManager are read at fire time on purpose — only the nonce fires it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Rows that left the Offer simply stop matching — the set is read through
  // the live rows, so a stale id never counts.
  const selectedJobs = jobs.filter((job) => selected.has(job.id));
  const selectionMixed =
    selectedJobs.length > 1 &&
    selectedJobs.some((job) => !samePart(partOf(job), partOf(selectedJobs[0]!)));

  async function handleMerge() {
    if (mergeBusy || selectedJobs.length < 2 || selectionMixed) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      const res = await mergeJobs(
        caseId,
        selectedJobs.map((job) => job.id),
      );
      if (!res.ok) {
        setMergeError(res.error);
        return;
      }
      setSelected(new Set());
      onMerged(res.value.survivor, res.value.absorbedIds);
    } finally {
      setMergeBusy(false);
    }
  }

  const partLabel = (part: (typeof parts)[number]) =>
    part.payerType === "CUSTOMER" ? t("review.customerPays") : t("review.insurerPays", { name: part.insurerName ?? t("payer.INSURER") });
  const unpriced = jobs.filter((job) => job.priceSatang == null).length;
  const missingCosts = jobs.filter((job) => job.partLines.some((line) => line.unitCostSatang == null)).length;

  return (
    <div ref={rootRef} className="scroll-mt-16">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div aria-live="polite" className="text-xs text-muted-foreground">
          <p className={unpriced > 0 ? "text-warn" : undefined}>{t(unpriced > 0 ? "review.unpricedCount" : "review.allPriced", { count: unpriced })}</p>
          {missingCosts > 0 && <p className="mt-1 text-warn">{t("review.missingCosts", { count: missingCosts })}</p>}
        </div>
        {!readOnly && jobs.length >= 2 && <button type="button" aria-pressed={mergeMode} className="text-xs text-muted-foreground hover:text-primary" onClick={() => { setMergeMode(!mergeMode); setSelected(new Set()); }}>{t(mergeMode ? "review.finishSelection" : "review.selectToMerge")}</button>}
      </div>
      {parts.map((part) => {
        const rows = jobs.filter((job) => samePart(partOf(job), part));
        return (
          <div key={partKey(part)}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-y bg-surface-2/50 px-4 py-2.5 sm:px-5">
              <h4 className="text-xs font-medium">{partLabel(part)} <span className="font-normal text-muted-foreground">· {t("phaseSub.jobs", { count: rows.length })}</span></h4>
              <span className="num text-xs text-muted-foreground">{formatBaht(rows.reduce((sum, job) => sum + (job.priceSatang ?? 0), 0))}{rows.some((job) => job.priceSatang == null) && ` · ${t("review.partialTotal")}`}</span>
            </div>
            {rows.map((job) => (
              <OfferRow
                key={job.id}
                caseId={caseId}
                job={job}
                mergeable={mergeable}
                checked={selected.has(job.id)}
                onCheck={(on) =>
                  setSelected((set) => {
                    const next = new Set(set);
                    if (on) next.add(job.id);
                    else next.delete(job.id);
                    return next;
                  })
                }
                staffOptions={staffOptions}
                isManager={isManager}
                readOnly={readOnly}
                priceRef={(el) => {
                  if (el) priceRefs.current.set(job.id, el);
                  else priceRefs.current.delete(job.id);
                }}
                onChanged={onChanged}
                onDeleted={onDeleted}
              />
            ))}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5">
        {selectedJobs.length >= 2 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={mergeBusy || selectionMixed}
            title={selectionMixed ? t("offer.mergeMixed") : undefined}
            className="h-8 border-primary-dim text-primary hover:bg-primary-soft"
            onClick={() => void handleMerge()}
          >
            <Merge data-icon="inline-start" />
            {t("offer.merge", { count: selectedJobs.length })}
          </Button>
        )}
        {mergeError && (
          <span role="alert" className="border border-bad/45 px-2 py-0.5 text-[11px] text-bad">
            {t(`errors.${mergeError}` as never)}
          </span>
        )}

      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One line of the Offer.                                              */
/* ------------------------------------------------------------------ */

function OfferRow({
  caseId,
  job,
  mergeable,
  checked,
  onCheck,
  staffOptions,
  isManager,
  readOnly,
  priceRef,
  onChanged,
  onDeleted,
}: {
  caseId: string;
  job: JobDto;
  mergeable: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  staffOptions: { id: string; name: string }[];
  isManager: boolean;
  readOnly: boolean;
  priceRef: (el: HTMLInputElement | null) => void;
  onChanged: (dto: JobDto) => void;
  onDeleted: (jobId: string) => void;
}) {
  const t = useTranslations("jobs");
  const ti = useTranslations("inspection");
  const tc = useTranslations("common");
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<JobError | null>(null);
  const [armedDelete, setArmedDelete] = useState(false);
  const [pendingInsurer, setPendingInsurer] = useState(false);

  const priceLive = !readOnly && (!job.catalogItemId || isManager);
  const unpriced = job.priceSatang == null;
  const findingLabel = (f: JobDto["findings"][number]) =>
    f.zone ? ti(`zones.${f.zone}` as never) : ti(`checklist.${f.checklistItem}` as never);

  async function run(action: () => Promise<Result>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChanged(res.value);
    } finally {
      setBusy(false);
    }
  }

  function savePrice(value: string) {
    const current = job.priceSatang != null ? satangToBahtInput(job.priceSatang) : "";
    if (value !== current) void run(() => updateJobPrice(job.id, value));
  }

  async function handleDelete() {
    if (!armedDelete) {
      setArmedDelete(true);
      setTimeout(() => setArmedDelete(false), 3000);
      return;
    }
    setArmedDelete(false);
    setBusy(true);
    setError(null);
    try {
      const res = await deleteJob(job.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDeleted(job.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPhotos(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(list)) {
        const blob = await downscalePhoto(file);
        const formData = new FormData();
        formData.append("photo", blob, "job.jpg");
        const res = await addJobPhoto(job.id, formData);
        if (!res.ok) {
          setError(res.error);
          break;
        }
        onChanged(res.value);
      }
    } finally {
      setBusy(false);
    }
  }

  const subWord = job.catalogItemId
    ? t("offer.catalog")
    : job.findings.length > 0
      ? t("offer.findingsCount", { count: job.findings.length })
      : null;

  return (
    <div className="border-t border-dashed">
      <div className={cn("flex items-start gap-3 px-4 py-3.5 sm:gap-4 sm:px-5", expanded && "bg-surface-2/40")}>
        {mergeable && <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.currentTarget.checked)} aria-label={t("offer.selectRow", { title: job.title })} className="mt-7 size-4 shrink-0 accent-[var(--primary)]" />}
        <div className="w-20 shrink-0 sm:w-28"><JobEvidence job={job} /></div>
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          <h5 className="text-[13px] font-medium leading-snug">{job.title}</h5>
          {subWord && <p className="mt-1 text-[11px] text-muted-foreground">{subWord}</p>}
          <p className="mt-2 text-[11px] text-muted-foreground">{job.partLines.length === 0 ? t("review.noPartsRecorded") : t("review.partsSummary", { count: job.partLines.length, cost: formatBaht(partsCostSatang(job)) })}</p>
          {job.partLines.some((line) => line.unitCostSatang == null) && <p className="mt-0.5 text-[11px] text-warn">{t("review.checkPartsCost")}</p>}
          <button type="button" onClick={() => { setExpanded(!expanded); setEditing(false); }} aria-expanded={expanded} className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary">
            {expanded ? <ChevronDown className="size-3" aria-hidden /> : <ChevronRight className="size-3" aria-hidden />}{t("review.jobDetails")}
          </button>
        </div>
        <div className="flex w-28 shrink-0 flex-col gap-1 sm:items-end">
          <span className="text-[10px] text-muted-foreground">{t("offer.colPrice")}</span>
        <span className="flex justify-end">
          {priceLive ? (
            <Input
              key={`price-${job.id}-${job.priceSatang ?? "none"}`}
              ref={priceRef}
              defaultValue={job.priceSatang != null ? satangToBahtInput(job.priceSatang) : ""}
              placeholder={t("offer.pricePlaceholder")}
              inputMode="decimal"
              aria-label={t("offer.colPrice")}
              disabled={busy}
              className={cn(
                "num h-7 w-full text-right text-[13px]",
                unpriced && "border-dashed border-warn/50 placeholder:text-warn/80",
              )}
              onBlur={(e) => savePrice(e.currentTarget.value.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          ) : (
            <span
              className={cn(
                "num flex items-center gap-1.5 text-[13px]",
                unpriced && "text-faint",
              )}
              title={job.catalogItemId && !readOnly ? t("priceLockedHint") : undefined}
            >
              {unpriced ? t("unpriced") : formatBaht(job.priceSatang!)}
              {job.catalogItemId && <Lock className="size-3 text-faint" aria-hidden />}
            </span>
          )}
        </span>
        <span className={cn("text-[11px]", unpriced ? "text-warn" : "text-muted-foreground")}>{t(unpriced ? "review.priceMissing" : "review.priceSet")}</span>
        </div>
        </div>
      </div>
      {error && <p role="alert" className="mx-4 mb-3 border border-bad/45 px-2 py-1 text-xs text-bad sm:mx-5">{t(`errors.${error}` as never)}</p>}

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-dashed bg-surface-2/40 px-4 py-2.5 sm:px-5 sm:pl-12">
          {job.priceOverriddenByName && (
            <p className="text-[10.5px] text-warn">
              {t("overriddenBy", { name: job.priceOverriddenByName })}
              {job.catalogPriceSatang != null &&
                ` · ${t("catalogPrice", { price: formatBaht(job.catalogPriceSatang) })}`}
            </p>
          )}

          {editing ? (
            <div className="flex flex-col gap-2">
              <Input
                key={`title-${job.id}-${job.title}`}
                defaultValue={job.title}
                aria-label={t("titleLabel")}
                className="h-8 text-[13px]"
                onBlur={(e) => {
                  const value = e.currentTarget.value.trim();
                  if (value && value !== job.title) void run(() => updateJob(job.id, { title: value }));
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  size="sm"
                  aria-label={t("offer.colPayer")}
                  value={pendingInsurer ? "INSURER" : job.payerType}
                  onChange={(value) => {
                    if (value === "CUSTOMER") {
                      setPendingInsurer(false);
                      if (job.payerType !== "CUSTOMER") {
                        void run(() => updateJob(job.id, { payerType: "CUSTOMER" }));
                      }
                    } else {
                      setPendingInsurer(true);
                    }
                  }}
                  options={[
                    { value: "CUSTOMER", label: t("payer.CUSTOMER") },
                    { value: "INSURER", label: t("payer.INSURER") },
                  ]}
                />
                {(job.payerType === "INSURER" || pendingInsurer) && (
                  <Input
                    key={`insurer-${job.id}-${job.insurerName ?? ""}`}
                    defaultValue={job.insurerName ?? ""}
                    placeholder={t("insurerPlaceholder")}
                    className="h-7 w-44 text-xs"
                    autoFocus={pendingInsurer}
                    onBlur={(e) => {
                      const value = e.currentTarget.value.trim();
                      setPendingInsurer(false);
                      if (value && value !== (job.insurerName ?? "")) {
                        void run(() =>
                          updateJob(job.id, { payerType: "INSURER", insurerName: value }),
                        );
                      }
                    }}
                  />
                )}
                <label className="flex items-center gap-1.5 text-[11px] text-faint">
                  {t("work.technician")}
                  <select
                    className={selectCls}
                    disabled={busy}
                    value={job.assignedStaffId ?? ""}
                    onChange={(e) => {
                      const value = e.currentTarget.value || null;
                      void run(() => updateJob(job.id, { assignedStaffId: value }));
                    }}
                  >
                    <option value="">{t("unassigned")}</option>
                    {staffOptions.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                key={`note-${job.id}-${job.note ?? ""}`}
                defaultValue={job.note ?? ""}
                placeholder={t("notePlaceholder")}
                rows={1}
                onBlur={(e) => {
                  const value = e.currentTarget.value.trim();
                  if (value !== (job.note ?? "")) void run(() => updateJob(job.id, { note: value }));
                }}
                className="w-full resize-y border border-dashed bg-transparent px-2 py-1 text-xs placeholder:text-faint focus:border-primary focus:outline-none"
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
              {job.findings.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-faint">{t("offer.fulfils")}</span>
                  {job.findings.map((f) => (
                    <Link
                      key={f.id}
                      href={`/cases/${caseId}/inspection`}
                      className="border border-border-strong px-1.5 py-px text-[11px] text-muted-foreground hover:border-primary-dim hover:text-primary"
                    >
                      {findingLabel(f)}
                    </Link>
                  ))}
                </span>
              )}
              {job.assignedStaffName && (
                <span className="text-muted-foreground">
                  {t("work.technician")} · {job.assignedStaffName}
                </span>
              )}
              {job.note && <span className="text-muted-foreground">“{job.note}”</span>}
              {job.partLines.length > 0 && (
                <span className="num text-muted-foreground">
                  {t("done.partsCost", {
                    count: job.partLines.length,
                    cost: formatBaht(partsCostSatang(job)),
                  })}
                </span>
              )}
            </div>
          )}

          <PartsTable
            job={job}
            rowsEditable={editing && !readOnly}
            statusLive={!readOnly}
            canAdd={!readOnly}
            onChanged={onChanged}
            onError={setError}
          />

          {(job.photos.length > 0 || !readOnly) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {job.photos.map((photo, i) => (
                <span key={photo.id} className="group relative">
                  <a href={`/api/photos/${photo.id}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; next/image would re-fetch without the session cookie */}
                    <img
                      src={`/api/photos/${photo.id}`}
                      alt={t("photoAlt", { n: i + 1 })}
                      className="h-20 w-24 border object-cover"
                      loading="lazy"
                    />
                  </a>
                  {editing && !readOnly && (
                    <button
                      type="button"
                      onClick={() => void run(() => removeJobPhoto(photo.id))}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center border bg-background text-[10px] text-faint hover:text-bad"
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
                    "flex h-11 cursor-pointer items-center gap-1 border border-dashed px-2 text-[11px] text-faint hover:border-primary-dim hover:text-primary",
                    busy && "animate-pulse",
                  )}
                >
                  <Camera className="size-3.5" aria-hidden />
                  {t("addPhoto")}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => {
                      void handleAddPhotos(e.currentTarget.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className={cn(
                  "flex items-center gap-1 border px-2 py-0.5 text-[10.5px]",
                  editing
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border-strong text-faint hover:border-primary-dim hover:text-primary",
                )}
                aria-pressed={editing}
              >
                {editing ? <Check className="size-3" aria-hidden /> : <Pencil className="size-3" aria-hidden />}
                {editing ? t("editDone") : tc("edit")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete()}
                className={cn(
                  "border px-2 py-0.5 text-[10.5px]",
                  armedDelete
                    ? "border-bad/60 bg-bad/15 text-bad"
                    : "border-border-strong text-faint hover:border-bad/50 hover:text-bad",
                )}
              >
                {armedDelete ? t("offer.deleteConfirm") : t("offer.delete")}
              </button>
            </div>
          )}


        </div>
      )}
    </div>
  );
}
