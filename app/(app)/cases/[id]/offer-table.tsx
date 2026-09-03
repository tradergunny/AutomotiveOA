"use client";

import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  Merge,
  Pencil,
  Plus,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Segmented } from "@/components/blocks/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downscalePhoto } from "@/lib/downscale";
import {
  coveringQuotation,
  latestQuotationForPart,
  offerParts,
  partKey,
  partOf,
  pricedOfferLines,
  samePart,
  type JobDto,
  type OfferPart,
  type QuotationDto,
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

/**
 * The Offer (D-19, D-21, D-24): every Proposed line as a table — Job, Payer,
 * Price — with the price cell live, because the Offer is the one part of the
 * page being built rather than read. Everything else about a line sits under
 * its expanded row behind Edit (D-7). Mixed payers split into sub-tables,
 * the insurer's name titling the second. A checkbox column appears once two
 * lines exist so panels can be merged into one job; the foot carries the
 * set-level tooling — Add job, the last send, Send quotation, Record
 * response — because a Quotation is issued for the set and the payer answers
 * about the set.
 */

type Props = {
  caseId: string;
  jobs: JobDto[]; // PROPOSED only, oldest first
  quotations: QuotationDto[]; // newest first
  staffOptions: { id: string; name: string }[];
  isManager: boolean;
  readOnly: boolean;
  /** Mirrors the header: Send quotation is the loud one while the Offer is unsent or stale. */
  sendPrimary: boolean;
  /** Bumped by the header's Set prices: scroll here and focus the first empty cell. */
  focusNonce: number;
  onChanged: (dto: JobDto) => void;
  onDeleted: (jobId: string) => void;
  onMerged: (survivor: JobDto, absorbedIds: string[]) => void;
  onAddJob: () => void;
  onSend: (part: OfferPart) => void;
  onRespond: (part: OfferPart) => void;
};

type Result = { ok: true; value: JobDto } | { ok: false; error: JobError };

const ROW_COLS =
  "grid-cols-[14px_minmax(0,1fr)_7rem] sm:grid-cols-[14px_minmax(0,1fr)_7.5rem_7rem]";
const ROW_COLS_MERGE =
  "grid-cols-[18px_14px_minmax(0,1fr)_7rem] sm:grid-cols-[18px_14px_minmax(0,1fr)_7.5rem_7rem]";

export function OfferTable({
  caseId,
  jobs,
  quotations,
  staffOptions,
  isManager,
  readOnly,
  sendPrimary,
  focusNonce,
  onChanged,
  onDeleted,
  onMerged,
  onAddJob,
  onSend,
  onRespond,
}: Props) {
  const t = useTranslations("jobs");
  const format = useFormatter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<JobError | null>(null);
  const priceRefs = useRef(new Map<string, HTMLInputElement>());
  const rootRef = useRef<HTMLDivElement>(null);

  const parts = offerParts(jobs);
  const mixed = parts.length > 1;
  const mergeable = !readOnly && jobs.length >= 2;

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

  const canSend = parts.some((part) => pricedOfferLines(jobs, part).length > 0);
  const canRespond = jobs.length > 0;
  const partLabel = (part: OfferPart) =>
    part.payerType === "CUSTOMER" ? t("payer.CUSTOMER") : (part.insurerName ?? t("payer.INSURER"));

  /** "Q-1031 · sent Sep 2 via LINE" / "Not sent", plus the staleness word. */
  const lastSendLine = (part: OfferPart) => {
    const latest = latestQuotationForPart(quotations, part);
    const priced = pricedOfferLines(jobs, part);
    const stale = latest != null && priced.length > 0 && coveringQuotation(quotations, priced) == null;
    return (
      <span key={partKey(part)} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
        {mixed && <span className="text-faint">{partLabel(part)} ·</span>}
        {latest ? (
          <>
            <Link
              href={`/cases/${caseId}/quotations/${latest.id}`}
              className="font-mono text-[12px] font-semibold text-primary hover:underline"
            >
              {latest.label}
            </Link>
            <span className="num text-muted-foreground">
              {latest.sentAt
                ? t("offer.sentVia", {
                    date: format.dateTime(new Date(latest.sentAt), { day: "numeric", month: "short" }),
                  })
                : format.dateTime(new Date(latest.issuedAt), { day: "numeric", month: "short" })}
            </span>
            {stale && <span className="text-warn">· {t("offer.stale")}</span>}
          </>
        ) : (
          <span className="text-faint">{t("offer.notSent")}</span>
        )}
      </span>
    );
  };

  const rowCols = mergeable ? ROW_COLS_MERGE : ROW_COLS;

  return (
    <div ref={rootRef} className="scroll-mt-16">
      {parts.map((part) => {
        const rows = jobs.filter((job) => samePart(partOf(job), part));
        return (
          <div key={partKey(part)}>
            {mixed && (
              <div className="px-4 pt-2 text-[11px] font-medium text-muted-foreground sm:px-5">
                {partLabel(part)}
              </div>
            )}
            {/* column heads — a table's, in a grid so rows can expand */}
            <div
              className={cn(
                "grid items-center gap-x-2.5 px-4 pt-1.5 pb-1 text-[10.5px] text-faint sm:px-5",
                rowCols,
              )}
            >
              {mergeable && <span />}
              <span />
              <span>{t("offer.colJob")}</span>
              <span className="hidden sm:block">{t("offer.colPayer")}</span>
              <span className="text-right">{t("offer.colPrice")}</span>
            </div>
            {rows.map((job) => (
              <OfferRow
                key={job.id}
                caseId={caseId}
                job={job}
                rowCols={rowCols}
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

      {/* the foot: set-level tooling (D-19, D-25) */}
      <div className="flex flex-wrap items-center gap-2 border-t border-dashed px-4 py-2.5 sm:px-5">
        {!readOnly && (
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={onAddJob}>
            <Plus data-icon="inline-start" />
            {t("offer.addJob")}
          </Button>
        )}
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
        <span className="ml-auto flex flex-col items-end gap-0.5">
          {parts.map((part) => lastSendLine(part))}
        </span>
        {!readOnly && (
          <>
            <Button
              type="button"
              size="sm"
              variant={sendPrimary ? "default" : "outline"}
              disabled={!canSend}
              title={!canSend ? t("offer.nothingPriced") : undefined}
              className={cn("h-8", sendPrimary && "font-semibold")}
              onClick={() => onSend(parts[0]!)}
            >
              <Send data-icon="inline-start" />
              {t("offer.sendQuotation")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sendPrimary ? "outline" : "default"}
              disabled={!canRespond}
              className={cn("h-8", !sendPrimary && "font-semibold")}
              onClick={() => onRespond(parts[0]!)}
            >
              {t("offer.recordResponse")}
            </Button>
          </>
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
  rowCols,
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
  rowCols: string;
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
  const payerText =
    job.payerType === "CUSTOMER" ? t("payer.CUSTOMER") : (job.insurerName ?? t("payer.INSURER"));
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
      <div
        className={cn(
          "grid min-h-10 items-center gap-x-2.5 px-4 py-1 sm:px-5",
          rowCols,
          expanded && "bg-surface-2/40",
        )}
      >
        {mergeable && (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.currentTarget.checked)}
            aria-label={t("offer.selectRow", { title: job.title })}
            className="size-3.5 accent-[var(--primary)]"
          />
        )}
        <button
          type="button"
          onClick={() => {
            setExpanded((v) => {
              if (v) setEditing(false);
              return !v;
            });
          }}
          aria-expanded={expanded}
          aria-label={job.title}
          className="flex size-5 items-center justify-center text-faint hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 truncate text-left text-[13px] font-medium hover:text-primary"
        >
          {job.title}
          {subWord && <span className="ml-1.5 text-[11px] font-normal text-faint">· {subWord}</span>}
        </button>
        <span className="hidden truncate text-[11px] text-faint sm:block">{payerText}</span>
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
      </div>

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
                      className="h-11 w-14 border object-cover opacity-90 group-hover:opacity-100"
                      loading="lazy"
                    />
                  </a>
                  {editing && !readOnly && (
                    <button
                      type="button"
                      onClick={() => void run(() => removeJobPhoto(photo.id))}
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

          {error && (
            <p role="alert" className="border border-bad/45 px-2 py-1 text-[11px] text-bad">
              {t(`errors.${error}` as never)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
