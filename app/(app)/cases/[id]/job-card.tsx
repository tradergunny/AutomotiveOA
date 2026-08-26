"use client";

import { Camera, ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { JobStatusBadge } from "@/components/blocks/job-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downscalePhoto } from "@/lib/downscale";
import {
  AUTH_CHANNELS,
  PART_ORDER_STATUSES,
  type JobDto,
  type PartLineDto,
  type QuotationDto,
} from "@/lib/jobs";
import { formatBaht, satangToBahtInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  addJobPhoto,
  addPartLine,
  deleteJob,
  recordAuthorization,
  removeJobPhoto,
  removePartLine,
  revertAuthorization,
  updateJob,
  updateJobPrice,
  updatePartLine,
  type JobActionResult,
  type JobError,
} from "./job-actions";

/**
 * One Job on the case page (M4 brief §3–§5, §7): collapsed row → expanded
 * editor with pricing, payer, authorization recording, part lines, and
 * relayed progress photos. Mutations reconcile through the returned JobDto,
 * M3-style.
 */

type Props = {
  job: JobDto;
  quotations: QuotationDto[]; // newest first
  staffOptions: { id: string; name: string }[];
  isManager: boolean;
  readOnly: boolean;
  onChanged: (dto: JobDto) => void;
  onDeleted: (job: JobDto) => void;
};

const selectCls =
  "border border-border-strong bg-transparent px-1.5 py-1 text-xs focus:border-primary focus:outline-none [&>option]:bg-popover";

function PartLineFields({ line }: { line?: PartLineDto }) {
  const t = useTranslations("jobs");
  return (
    <>
      <Input
        name="name"
        defaultValue={line?.name ?? ""}
        placeholder={t("parts.name")}
        required
        className="h-8 min-w-0 flex-[2] text-xs"
      />
      <Input
        name="quantity"
        type="number"
        min={1}
        max={999}
        defaultValue={line?.quantity ?? 1}
        className="num h-8 w-16 flex-none text-right text-xs"
        aria-label={t("parts.quantity")}
      />
      <Input
        name="unitCost"
        defaultValue={line?.unitCostSatang != null ? satangToBahtInput(line.unitCostSatang) : ""}
        placeholder={t("parts.unitCost")}
        inputMode="decimal"
        className="num h-8 w-24 flex-none text-right text-xs"
      />
      <Input
        name="supplier"
        defaultValue={line?.supplier ?? ""}
        placeholder={t("parts.supplier")}
        className="h-8 min-w-0 flex-1 text-xs"
      />
      <Input
        name="etaDate"
        type="date"
        defaultValue={line?.etaDate ?? ""}
        className="num h-8 w-36 flex-none text-xs"
        aria-label={t("parts.eta")}
      />
      <Input
        name="note"
        defaultValue={line?.note ?? ""}
        placeholder={t("parts.note")}
        className="h-8 min-w-0 flex-1 text-xs"
      />
    </>
  );
}

export function JobCard({
  job,
  quotations,
  staffOptions,
  isManager,
  readOnly,
  onChanged,
  onDeleted,
}: Props) {
  const t = useTranslations("jobs");
  const ti = useTranslations("inspection");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<JobError | null>(null);
  const [armed, setArmed] = useState<"delete" | "revert" | null>(null);
  const [pendingInsurer, setPendingInsurer] = useState(false);
  const [editingPart, setEditingPart] = useState<string | null>(null);
  const [authChannel, setAuthChannel] = useState<(typeof AUTH_CHANNELS)[number]>("PHONE");
  const [authQuotationId, setAuthQuotationId] = useState<string>(quotations[0]?.id ?? "");
  const [authNote, setAuthNote] = useState("");

  const proposed = job.status === "PROPOSED";
  const canEditCore = proposed && !readOnly;

  async function run(action: () => Promise<JobActionResult<JobDto>>) {
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

  function arm(kind: "delete" | "revert", go: () => void) {
    if (armed !== kind) {
      setArmed(kind);
      setTimeout(() => setArmed((cur) => (cur === kind ? null : cur)), 3000);
      return;
    }
    setArmed(null);
    go();
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteJob(job.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDeleted(job);
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

  const findingLabel = (f: JobDto["findings"][number]) =>
    f.zone ? ti(`zones.${f.zone}` as never) : ti(`checklist.${f.checklistItem}` as never);

  const partsArrived = job.partLines.filter((p) => p.orderStatus === "ARRIVED").length;

  const partLineInput = (formData: FormData) => ({
    name: String(formData.get("name") ?? ""),
    quantity: String(formData.get("quantity") ?? "1"),
    unitCost: String(formData.get("unitCost") ?? ""),
    supplier: String(formData.get("supplier") ?? ""),
    etaDate: String(formData.get("etaDate") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  return (
    <li className="border-b last:border-b-0">
      {/* collapsed row */}
      <button
        type="button"
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-3.5 py-2.5 text-left hover:bg-surface-2"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 flex-none text-faint" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 flex-none text-faint" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{job.title}</span>
        <JobStatusBadge status={job.status} />
        <span className="border border-border-strong px-1.5 py-px text-[10.5px] text-muted-foreground">
          {job.payerType === "CUSTOMER" ? t("payer.CUSTOMER") : (job.insurerName ?? t("payer.INSURER"))}
        </span>
        {job.partLines.length > 0 && (
          <span className="num text-[10.5px] text-faint">
            {t("partsRollup", { total: job.partLines.length, arrived: partsArrived })}
          </span>
        )}
        <span className={cn("num text-[13px]", job.priceSatang == null && "text-faint")}>
          {job.priceSatang == null ? t("unpriced") : formatBaht(job.priceSatang)}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-dashed bg-surface-2/40 px-3.5 py-3">
          {/* title + payer + price */}
          <div className="flex flex-wrap items-start gap-x-5 gap-y-2.5">
            <div className="flex min-w-52 flex-1 flex-col gap-1">
              <span className="eyebrow">{t("titleLabel")}</span>
              {canEditCore ? (
                <Input
                  key={`title-${job.id}-${job.title}`}
                  defaultValue={job.title}
                  className="h-8 text-[13px]"
                  onBlur={(e) => {
                    const value = e.currentTarget.value.trim();
                    if (value && value !== job.title) void run(() => updateJob(job.id, { title: value }));
                  }}
                />
              ) : (
                <span className="text-[13px]">{job.title}</span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="eyebrow">{t("payerLabel")}</span>
              {canEditCore ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex border border-border-strong">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPendingInsurer(false);
                        if (job.payerType !== "CUSTOMER") {
                          void run(() => updateJob(job.id, { payerType: "CUSTOMER" }));
                        }
                      }}
                      className={cn(
                        "px-2 py-0.5 text-[10.5px]",
                        job.payerType === "CUSTOMER" && !pendingInsurer
                          ? "bg-primary-soft text-primary"
                          : "text-faint hover:text-foreground",
                      )}
                      aria-pressed={job.payerType === "CUSTOMER"}
                    >
                      {t("payer.CUSTOMER")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPendingInsurer(true)}
                      className={cn(
                        "border-l border-border-strong px-2 py-0.5 text-[10.5px]",
                        job.payerType === "INSURER" || pendingInsurer
                          ? "bg-primary-soft text-primary"
                          : "text-faint hover:text-foreground",
                      )}
                      aria-pressed={job.payerType === "INSURER"}
                    >
                      {t("payer.INSURER")}
                    </button>
                  </span>
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
                </div>
              ) : (
                <span className="text-xs">
                  {job.payerType === "CUSTOMER"
                    ? t("payer.CUSTOMER")
                    : `${t("payer.INSURER")} · ${job.insurerName ?? ""}`}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="eyebrow">{t("priceLabel")}</span>
              <div className="flex items-center gap-2">
                {canEditCore && (!job.catalogItemId || isManager) ? (
                  <Input
                    key={`price-${job.id}-${job.priceSatang ?? "none"}`}
                    defaultValue={job.priceSatang != null ? satangToBahtInput(job.priceSatang) : ""}
                    placeholder={t("pricePlaceholder")}
                    inputMode="decimal"
                    className="num h-8 w-28 text-right text-[13px]"
                    onBlur={(e) => {
                      const value = e.currentTarget.value.trim();
                      const current =
                        job.priceSatang != null ? satangToBahtInput(job.priceSatang) : "";
                      if (value !== current) void run(() => updateJobPrice(job.id, value));
                    }}
                  />
                ) : (
                  <span className="num text-[13px]">
                    {job.priceSatang == null ? t("unpriced") : formatBaht(job.priceSatang)}
                  </span>
                )}
                {job.catalogItemId && (
                  <span
                    className="border border-dashed border-border-strong px-1.5 py-px font-mono text-[9px] tracking-wider text-faint"
                    title={job.catalogItemName ?? undefined}
                  >
                    {t("fromCatalog")}
                  </span>
                )}
              </div>
              {job.catalogItemId && canEditCore && !isManager && (
                <span className="text-[10.5px] text-faint">{t("priceLockedHint")}</span>
              )}
              {job.priceOverriddenByName && (
                <span className="hatch-soft w-fit border border-warn/45 px-1.5 py-px text-[10.5px] text-warn">
                  {t("overriddenBy", { name: job.priceOverriddenByName })}
                  {job.catalogPriceSatang != null &&
                    ` · ${t("catalogPrice", { price: formatBaht(job.catalogPriceSatang) })}`}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="eyebrow">{t("assigneeLabel")}</span>
              <select
                className={selectCls}
                disabled={readOnly || busy}
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
            </div>
          </div>

          {/* fulfilled findings */}
          {job.findings.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow">{t("findingsLabel")}</span>
              {job.findings.map((f) => (
                <span
                  key={f.id}
                  className="border border-border-strong px-1.5 py-px text-[10.5px] text-muted-foreground"
                >
                  {findingLabel(f)}
                </span>
              ))}
            </div>
          )}

          {/* note */}
          <textarea
            key={`note-${job.id}-${job.note ?? ""}`}
            defaultValue={job.note ?? ""}
            placeholder={t("notePlaceholder")}
            readOnly={readOnly}
            rows={1}
            onBlur={(e) => {
              const value = e.currentTarget.value.trim();
              if (value !== (job.note ?? "")) void run(() => updateJob(job.id, { note: value }));
            }}
            className="w-full resize-y border border-dashed bg-transparent px-2 py-1 text-xs placeholder:text-faint focus:border-primary focus:outline-none"
          />

          {/* part lines */}
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow">{t("parts.title")}</span>
            {job.partLines.length === 0 && (
              <span className="text-[11px] text-faint">{t("parts.empty")}</span>
            )}
            {job.partLines.map((line) =>
              editingPart === line.id ? (
                <form
                  key={line.id}
                  action={(formData) => {
                    setEditingPart(null);
                    void run(() =>
                      updatePartLine(line.id, {
                        ...partLineInput(formData),
                        orderStatus: String(formData.get("orderStatus") ?? line.orderStatus),
                      }),
                    );
                  }}
                  className="flex flex-wrap items-center gap-1.5 border border-dashed p-1.5"
                >
                  <PartLineFields line={line} />
                  <input type="hidden" name="orderStatus" value={line.orderStatus} />
                  <Button type="submit" size="sm" disabled={busy} className="h-8 font-semibold">
                    {tc("save")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditingPart(null)}>
                    {tc("cancel")}
                  </Button>
                </form>
              ) : (
                <div key={line.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {line.name}
                    <span className="num text-faint"> ×{line.quantity}</span>
                    {line.supplier && (
                      <span className="ml-1.5 text-muted-foreground">· {line.supplier}</span>
                    )}
                    {line.unitCostSatang != null && (
                      <span className="num ml-1.5 text-faint">
                        {t("parts.costShort", { price: formatBaht(line.unitCostSatang) })}
                      </span>
                    )}
                    {line.note && <span className="ml-1.5 text-faint">· {line.note}</span>}
                  </span>
                  {line.etaDate && (
                    <span className="num text-[10.5px] text-faint">
                      {t("parts.etaShort", {
                        date: format.dateTime(new Date(`${line.etaDate}T00:00:00`), {
                          day: "numeric",
                          month: "short",
                        }),
                      })}
                    </span>
                  )}
                  <select
                    className={cn(
                      selectCls,
                      "py-0.5 text-[10.5px]",
                      line.orderStatus === "ARRIVED"
                        ? "border-ok/50 text-ok"
                        : line.orderStatus === "ORDERED"
                          ? "border-info/50 text-info"
                          : "text-muted-foreground",
                    )}
                    disabled={readOnly || busy}
                    value={line.orderStatus}
                    onChange={(e) =>
                      void run(() =>
                        updatePartLine(line.id, {
                          name: line.name,
                          quantity: String(line.quantity),
                          unitCost:
                            line.unitCostSatang != null
                              ? satangToBahtInput(line.unitCostSatang)
                              : "",
                          supplier: line.supplier ?? "",
                          etaDate: line.etaDate ?? "",
                          note: line.note ?? "",
                          orderStatus: e.currentTarget.value,
                        }),
                      )
                    }
                  >
                    {PART_ORDER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(`parts.status.${status}`)}
                      </option>
                    ))}
                  </select>
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditingPart(line.id)}
                        className="p-0.5 text-faint hover:text-foreground"
                        aria-label={tc("edit")}
                      >
                        <Pencil className="size-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void run(() => removePartLine(line.id))}
                        className="p-0.5 text-faint hover:text-bad"
                        aria-label={t("parts.remove")}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              ),
            )}
            {!readOnly && editingPart == null && (
              <form
                action={(formData) => {
                  void run(() => addPartLine(job.id, partLineInput(formData)));
                }}
                className="flex flex-wrap items-center gap-1.5"
              >
                <PartLineFields />
                <Button type="submit" size="sm" variant="outline" disabled={busy} className="h-8">
                  {t("parts.add")}
                </Button>
              </form>
            )}
          </div>

          {/* photos: relayed progress shots */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="eyebrow w-full">{t("photosLabel")}</span>
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
                {!readOnly && (
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
                  "flex h-11 w-14 cursor-pointer items-center justify-center border border-dashed text-primary hover:border-primary",
                  busy && "animate-pulse",
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
                  disabled={busy}
                  onChange={(e) => {
                    void handleAddPhotos(e.currentTarget.files);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            )}
          </div>

          {/* authorization */}
          <div className="flex flex-col gap-2 border-t border-dashed pt-2.5">
            <span className="eyebrow">{t("auth.title")}</span>

            {job.authorizations.length > 0 && (
              <ul className="flex flex-col gap-1">
                {job.authorizations.map((auth) => (
                  <li key={auth.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    <span
                      className={cn(
                        "border px-1.5 py-px font-mono text-[9.5px] tracking-wider",
                        auth.decision === "AUTHORIZED" && "border-ok/50 text-ok",
                        auth.decision === "DECLINED" && "border-bad/50 text-bad",
                        auth.decision === "REVERTED" && "border-border-strong text-muted-foreground",
                      )}
                    >
                      {t(`auth.decision.${auth.decision}`)}
                    </span>
                    {auth.channel && <span>{t(`auth.channel.${auth.channel}`)}</span>}
                    {auth.quotationLabel && (
                      <span className="font-mono text-faint">{auth.quotationLabel}</span>
                    )}
                    {auth.note && <span className="text-muted-foreground">· {auth.note}</span>}
                    <span className="num ml-auto text-[10px] text-faint">
                      {format.dateTime(new Date(auth.recordedAt), {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {auth.recordedByName}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {canEditCore && (
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  className={selectCls}
                  value={authChannel}
                  onChange={(e) =>
                    setAuthChannel(e.currentTarget.value as (typeof AUTH_CHANNELS)[number])
                  }
                  aria-label={t("auth.channelLabel")}
                >
                  {AUTH_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {t(`auth.channel.${channel}`)}
                    </option>
                  ))}
                </select>
                {quotations.length > 0 && (
                  <select
                    className={selectCls}
                    value={authQuotationId}
                    onChange={(e) => setAuthQuotationId(e.currentTarget.value)}
                    aria-label={t("auth.quotationLabel")}
                  >
                    <option value="">{t("auth.noQuotation")}</option>
                    {quotations.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                )}
                <Input
                  value={authNote}
                  onChange={(e) => setAuthNote(e.currentTarget.value)}
                  placeholder={t("auth.notePlaceholder")}
                  className="h-7 w-48 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || job.priceSatang == null}
                  className="h-7 font-semibold"
                  title={job.priceSatang == null ? t("auth.needsPrice") : undefined}
                  onClick={() => {
                    void run(() =>
                      recordAuthorization(job.id, {
                        decision: "AUTHORIZED",
                        channel: authChannel,
                        note: authNote,
                        quotationId: authQuotationId || undefined,
                      }),
                    );
                    setAuthNote("");
                  }}
                >
                  {t("auth.recordAuthorized")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="h-7 border-bad/50 text-bad hover:bg-bad/10"
                  onClick={() => {
                    void run(() =>
                      recordAuthorization(job.id, {
                        decision: "DECLINED",
                        channel: authChannel,
                        note: authNote,
                        quotationId: authQuotationId || undefined,
                      }),
                    );
                    setAuthNote("");
                  }}
                >
                  {t("auth.recordDeclined")}
                </Button>
              </div>
            )}

            {!readOnly &&
              isManager &&
              (job.status === "AUTHORIZED" || job.status === "DECLINED") && (
                <button
                  type="button"
                  onClick={() => arm("revert", () => void run(() => revertAuthorization(job.id)))}
                  className={cn(
                    "w-fit border px-2 py-0.5 text-[10.5px]",
                    armed === "revert"
                      ? "border-warn/60 bg-warn/15 text-warn"
                      : "border-border-strong text-faint hover:text-warn",
                  )}
                >
                  {armed === "revert" ? t("auth.revertConfirm") : t("auth.revert")}
                </button>
              )}
          </div>

          {/* footer: created / delete */}
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-faint">
              {t("createdAt", {
                when: format.dateTime(new Date(job.createdAt), {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </span>
            {canEditCore && (
              <button
                type="button"
                onClick={() => arm("delete", () => void handleDelete())}
                className={cn(
                  "ml-auto border px-2 py-0.5 text-[10.5px]",
                  armed === "delete"
                    ? "border-bad/60 bg-bad/15 text-bad"
                    : "border-border-strong text-faint hover:text-bad",
                )}
              >
                {armed === "delete" ? t("deleteConfirm") : t("delete")}
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="border border-bad/45 px-2 py-1 text-[11px] text-bad">
              {t(`errors.${error}`)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
