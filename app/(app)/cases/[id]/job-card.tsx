"use client";

import {
  Ban,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Pencil,
  Play,
  Plus,
  Shield,
  ShieldCheck,
  ShieldX,
  Undo2,
  X,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { JobStatusBadge } from "@/components/blocks/job-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  canFlow,
  isActiveJob,
  REVERTIBLE_STATUSES,
  WAITING_REASONS,
  type JobFlowAction,
} from "@/lib/case-flow";
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
import { revertJobStep, transitionJob, type FlowError } from "./flow-actions";
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
  type JobError,
} from "./job-actions";

/**
 * One Job on the case page, rebuilt as a record, not a form (M7.5, D-7).
 * The collapsed row is title · one status chip · payer and price as plain
 * text. Expanded, a card shows only what its status warrants: Proposed is
 * the offer with the authorize/decline controls, an active job is the
 * working view (technician, spread parts, transitions, photos), Completed
 * is a receipt, Cancelled/Declined one quiet line with the reason. Field
 * edits live behind the per-card Edit toggle; actions are not edits —
 * transitions, authorization recording, and part-arrival stay one tap.
 */

type Props = {
  job: JobDto;
  quotations: QuotationDto[]; // newest first
  staffOptions: { id: string; name: string }[];
  isManager: boolean;
  canSignOffQc: boolean;
  canCancelJob: boolean;
  canRevertStep: boolean;
  viewerStaffId: string;
  readOnly: boolean;
  onChanged: (dto: JobDto) => void;
  onDeleted: (job: JobDto) => void;
};

type CardError = JobError | FlowError;
type CardResult = { ok: true; value: JobDto } | { ok: false; error: CardError };

const selectCls =
  "border border-border-strong bg-transparent px-1.5 py-1 text-xs focus:border-primary focus:outline-none [&>option]:bg-popover";

const partHeadCls = "px-1.5 pb-1 text-left text-[10.5px] font-normal text-faint";
const partCellCls = "px-1.5 py-1";

/**
 * The five editable cells of a part line, shared by the edit row and the
 * entry row.
 *
 * They reach their <form> through the form attribute rather than being
 * wrapped in one: a <form> cannot sit between <tbody> and <tr> without the
 * browser hoisting it out of the table, which would break the column grid
 * the whole point of this layout depends on.
 *
 * Enter is wired explicitly rather than left to implicit submission. Typing
 * across the row and pressing Enter is most of why the row is worth having,
 * and whether the browser finds a default button through the form attribute
 * is a corner of the spec not worth betting the interaction on. Handling it
 * ourselves costs one preventDefault and makes it certain.
 */
function PartInputCells({
  line,
  formId,
  nameRef,
}: {
  line?: PartLineDto;
  formId: string;
  nameRef?: Ref<HTMLInputElement>;
}) {
  const t = useTranslations("jobs");
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    // requestSubmit, not submit: it still runs the required-name check.
    const form = document.getElementById(formId);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  };
  return (
    <>
      <td className={partCellCls}>
        <div className="flex items-center gap-1.5">
          <Input
            ref={nameRef}
            onKeyDown={submitOnEnter}
            form={formId}
            name="name"
            defaultValue={line?.name ?? ""}
            placeholder={t("parts.name")}
            required
            className="h-7 min-w-24 flex-[3] text-xs"
          />
          <Input
            form={formId}
            onKeyDown={submitOnEnter}
            name="note"
            defaultValue={line?.note ?? ""}
            placeholder={t("parts.note")}
            className="h-7 min-w-16 flex-[2] text-xs"
          />
        </div>
      </td>
      <td className={partCellCls}>
        <Input
          form={formId}
          onKeyDown={submitOnEnter}
          name="quantity"
          type="number"
          min={1}
          max={999}
          defaultValue={line?.quantity ?? 1}
          className="num h-7 w-14 text-right text-xs"
          aria-label={t("parts.quantity")}
        />
      </td>
      <td className={partCellCls}>
        <Input
          form={formId}
          onKeyDown={submitOnEnter}
          name="unitCost"
          defaultValue={line?.unitCostSatang != null ? satangToBahtInput(line.unitCostSatang) : ""}
          inputMode="decimal"
          className="num h-7 w-20 text-right text-xs"
          aria-label={t("parts.unitCost")}
        />
      </td>
      <td className={partCellCls}>
        <Input
          form={formId}
          onKeyDown={submitOnEnter}
          name="supplier"
          defaultValue={line?.supplier ?? ""}
          className="h-7 w-full min-w-20 text-xs"
          aria-label={t("parts.supplier")}
        />
      </td>
      <td className={partCellCls}>
        <Input
          form={formId}
          onKeyDown={submitOnEnter}
          name="etaDate"
          type="date"
          defaultValue={line?.etaDate ?? ""}
          className="num h-7 w-32 text-xs"
          aria-label={t("parts.eta")}
        />
      </td>
    </>
  );
}

export function JobCard({
  job,
  quotations,
  staffOptions,
  isManager,
  canSignOffQc,
  canCancelJob,
  canRevertStep,
  viewerStaffId,
  readOnly,
  onChanged,
  onDeleted,
}: Props) {
  const t = useTranslations("jobs");
  const ti = useTranslations("inspection");
  const tc = useTranslations("common");
  const twr = useTranslations("waitingReasons");
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CardError | null>(null);
  const [armed, setArmed] = useState<"delete" | "revert" | "revertStep" | null>(null);
  const [pendingInsurer, setPendingInsurer] = useState(false);
  const [addingPart, setAddingPart] = useState(false);
  const [editingPart, setEditingPart] = useState<string | null>(null);
  const [authChannel, setAuthChannel] = useState<(typeof AUTH_CHANNELS)[number]>("PHONE");
  const [authQuotationId, setAuthQuotationId] = useState<string>(quotations[0]?.id ?? "");
  const [authNote, setAuthNote] = useState("");
  const [flowMode, setFlowMode] = useState<null | "waiting" | "qcfail" | "cancel">(null);
  const [flowReason, setFlowReason] = useState<string>(job.waitingReason ?? "PARTS");
  const [flowNote, setFlowNote] = useState("");

  const proposed = job.status === "PROPOSED";
  const active = isActiveJob(job.status);
  const completed = job.status === "COMPLETED";
  const closed = job.status === "DECLINED" || job.status === "CANCELLED";
  const canEditCore = proposed && !readOnly && editing;

  function toggleExpanded() {
    setExpanded((v) => {
      if (v) {
        setEditing(false);
        setAddingPart(false);
        setEditingPart(null);
        setFlowMode(null);
      }
      return !v;
    });
  }

  async function run(action: () => Promise<CardResult>) {
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

  function arm(kind: "delete" | "revert" | "revertStep", go: () => void) {
    if (armed !== kind) {
      setArmed(kind);
      setTimeout(() => setArmed((cur) => (cur === kind ? null : cur)), 3000);
      return;
    }
    setArmed(null);
    go();
  }

  const mayFlow = (action: JobFlowAction) => canFlow(action, job.status);

  async function flow(input: { action: JobFlowAction; waitingReason?: string; note?: string }) {
    await run(() => transitionJob(job.id, input));
    setFlowMode(null);
    setFlowNote("");
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

  const payerText =
    job.payerType === "CUSTOMER" ? t("payer.CUSTOMER") : (job.insurerName ?? t("payer.INSURER"));

  const partsArrived = job.partLines.filter((p) => p.orderStatus === "ARRIVED").length;
  const partsCostSatang = job.partLines.reduce(
    (sum, line) => sum + (line.unitCostSatang ?? 0) * line.quantity,
    0,
  );

  const partLineInput = (formData: FormData) => ({
    name: String(formData.get("name") ?? ""),
    quantity: String(formData.get("quantity") ?? "1"),
    unitCost: String(formData.get("unitCost") ?? ""),
    supplier: String(formData.get("supplier") ?? ""),
    etaDate: String(formData.get("etaDate") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  // Two ids because both forms live outside the table and their fields find
  // them by form=; scoped by job so several expanded cards can coexist.
  const addPartFormId = `add-part-${job.id}`;
  const editPartFormId = `edit-part-${job.id}`;
  const addPartFormRef = useRef<HTMLFormElement>(null);
  const addPartNameRef = useRef<HTMLInputElement>(null);
  const editingLine = job.partLines.find((line) => line.id === editingPart) ?? null;

  // Not run() — a failed add must leave the row exactly as typed, and a
  // successful one must hand the cursor straight back for the next part.
  async function handleAddPart(formData: FormData) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addPartLine(job.id, partLineInput(formData));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChanged(res.value);
      addPartFormRef.current?.reset();
      addPartNameRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- shared quiet fragments ---------------- */

  const findingsLine = job.findings.length > 0 && (
    <p className="text-[11px] text-faint">
      {t("findingsLabel")} · {job.findings.map(findingLabel).join(" + ")}
    </p>
  );

  const noteLine = job.note && !editing && (
    <p className="text-xs text-muted-foreground">“{job.note}”</p>
  );

  /** The latest decisive authorization entries, as quiet provenance lines. */
  const authHistory = job.authorizations.length > 0 && (
    <ul className="flex flex-col gap-0.5">
      {job.authorizations.map((auth) => (
        <li key={auth.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
          <span
            className={cn(
              auth.decision === "AUTHORIZED" && "text-ok",
              auth.decision === "DECLINED" && "text-bad",
              auth.decision === "REVERTED" && "text-muted-foreground",
            )}
          >
            {t(`auth.decision.${auth.decision}`)}
          </span>
          <span className="text-muted-foreground">
            {auth.channel && `· ${t(`auth.channel.${auth.channel}`)} `}
            {auth.quotationLabel && (
              <span className="font-mono">· {auth.quotationLabel} </span>
            )}
            {auth.note && `· “${auth.note}” `}
          </span>
          <span className="num text-[10px] text-faint">
            {format.dateTime(new Date(auth.recordedAt), { day: "numeric", month: "short" })} ·{" "}
            {auth.recordedByName}
          </span>
        </li>
      ))}
    </ul>
  );

  /** One summary line once terminal (D-7) — never a table. */
  const partsSummaryLine = job.partLines.length > 0 && (
    <p className="num text-[11px] text-faint">
      {t("partsSummary", { count: job.partLines.length })}
      {partsCostSatang > 0 && ` · ${formatBaht(partsCostSatang)}`}
    </p>
  );

  const editButton = !readOnly && !closed && (
    <button
      type="button"
      onClick={() => {
        setEditing((v) => !v);
        setAddingPart(false);
        setEditingPart(null);
      }}
      className={cn(
        "ml-auto flex items-center gap-1 border px-2 py-0.5 text-[11px]",
        editing
          ? "border-primary bg-primary-soft text-primary"
          : "border-border-strong text-faint hover:border-primary-dim hover:text-primary",
      )}
      aria-pressed={editing}
    >
      {editing ? <Check className="size-3" aria-hidden /> : <Pencil className="size-3" aria-hidden />}
      {editing ? t("editDone") : tc("edit")}
    </button>
  );

  /* ---------------- parts (working view: spread while active) ---------------- */

  const partsRowsEditable = editing && !readOnly && !closed && !completed;
  const partsStatusLive = !readOnly && (active || proposed);
  const showPartsTable = job.partLines.length > 0 || addingPart;

  const partsBlock = (
    <div className="flex flex-col gap-1.5">
      {showPartsTable && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-xs">
            <thead>
              <tr className="border-b border-dashed">
                <th className={partHeadCls}>{t("parts.col.part")}</th>
                <th className={cn(partHeadCls, "text-right")}>{t("parts.col.qty")}</th>
                <th className={cn(partHeadCls, "text-right")}>{t("parts.col.unit")}</th>
                <th className={partHeadCls}>{t("parts.col.supplier")}</th>
                <th className={partHeadCls}>{t("parts.col.eta")}</th>
                <th className={partHeadCls}>{t("parts.col.status")}</th>
                <th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {job.partLines.map((line) =>
                editingPart === line.id ? (
                  <tr key={line.id} className="border-b border-dashed">
                    <PartInputCells line={line} formId={editPartFormId} />
                    <td className={partCellCls}>
                      <select
                        form={editPartFormId}
                        name="orderStatus"
                        defaultValue={line.orderStatus}
                        className={cn(selectCls, "w-full py-0.5 text-[10.5px]")}
                        aria-label={t("parts.col.status")}
                      >
                        {PART_ORDER_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {t(`parts.status.${status}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={cn(partCellCls, "whitespace-nowrap")}>
                      <button
                        type="submit"
                        form={editPartFormId}
                        disabled={busy}
                        className="p-0.5 text-faint hover:text-primary"
                        aria-label={tc("save")}
                      >
                        <Check className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPart(null)}
                        className="p-0.5 text-faint hover:text-foreground"
                        aria-label={tc("cancel")}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={line.id} className="border-b border-dashed">
                    <td className={partCellCls}>
                      {line.name}
                      {line.note && <span className="ml-1.5 text-faint">· {line.note}</span>}
                    </td>
                    <td className={cn(partCellCls, "num text-right")}>{line.quantity}</td>
                    <td
                      className={cn(
                        partCellCls,
                        "num text-right",
                        line.unitCostSatang == null && "text-faint",
                      )}
                    >
                      {line.unitCostSatang == null ? "—" : formatBaht(line.unitCostSatang)}
                    </td>
                    <td className={cn(partCellCls, !line.supplier && "text-faint")}>
                      {line.supplier || "—"}
                    </td>
                    <td
                      className={cn(
                        partCellCls,
                        "num whitespace-nowrap",
                        !line.etaDate && "text-faint",
                      )}
                    >
                      {line.etaDate
                        ? format.dateTime(new Date(`${line.etaDate}T00:00:00`), {
                            day: "numeric",
                            month: "short",
                          })
                        : "—"}
                    </td>
                    <td className={partCellCls}>
                      {/* Part-arrival is an action, not an edit (D-7): live always. */}
                      {partsStatusLive ? (
                        <select
                          className={cn(
                            selectCls,
                            "w-full py-0.5 text-[10.5px]",
                            line.orderStatus === "ARRIVED"
                              ? "border-ok/50 text-ok"
                              : line.orderStatus === "ORDERED"
                                ? "border-info/50 text-info"
                                : "text-muted-foreground",
                          )}
                          disabled={busy}
                          value={line.orderStatus}
                          aria-label={t("parts.col.status")}
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
                      ) : (
                        <span
                          className={cn(
                            "text-[10.5px]",
                            line.orderStatus === "ARRIVED" ? "text-ok" : "text-muted-foreground",
                          )}
                        >
                          {t(`parts.status.${line.orderStatus}`)}
                        </span>
                      )}
                    </td>
                    <td className={cn(partCellCls, "whitespace-nowrap")}>
                      {partsRowsEditable && (
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
                    </td>
                  </tr>
                ),
              )}

              {addingPart && (
                <tr className="bg-surface-2/50">
                  <PartInputCells formId={addPartFormId} nameRef={addPartNameRef} />
                  <td className={cn(partCellCls, "text-[10.5px] text-faint")}>
                    {t("parts.status.NOT_ORDERED")}
                  </td>
                  <td className={cn(partCellCls, "whitespace-nowrap")}>
                    <Button
                      type="submit"
                      form={addPartFormId}
                      size="icon-sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={t("parts.add")}
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </Button>
                    <button
                      type="button"
                      onClick={() => setAddingPart(false)}
                      className="ml-1 p-0.5 text-faint hover:text-foreground"
                      aria-label={tc("cancel")}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* No headings over nothing (D-7): adding is a small affordance. */}
      {!readOnly && (active || proposed) && !addingPart && (
        <button
          type="button"
          onClick={() => {
            setAddingPart(true);
            setTimeout(() => addPartNameRef.current?.focus(), 0);
          }}
          className="flex w-fit items-center gap-1 text-[11px] text-faint hover:text-primary"
        >
          <Plus className="size-3" aria-hidden />
          {t("parts.add")}
        </button>
      )}

      {/* The forms those rows submit into (see PartInputCells). */}
      {!readOnly && (
        <>
          <form
            id={addPartFormId}
            ref={addPartFormRef}
            action={(formData) => void handleAddPart(formData)}
          />
          {editingLine && (
            <form
              id={editPartFormId}
              action={(formData) => {
                const lineId = editingLine.id;
                setEditingPart(null);
                void run(() =>
                  updatePartLine(lineId, {
                    ...partLineInput(formData),
                    orderStatus: String(formData.get("orderStatus") ?? editingLine.orderStatus),
                  }),
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );

  /* ---------------- photos (working view + receipt) ---------------- */

  const canAddPhotos = !readOnly && (active || proposed);
  const photosBlock = (job.photos.length > 0 || canAddPhotos) && (
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
          {canAddPhotos && editing && (
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
      {canAddPhotos && (
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
  );

  /* ---------------- transitions (actions are not edits: always visible) ---------------- */

  const transitionsBlock = !readOnly &&
    (mayFlow("START_WORK") ||
      mayFlow("SEND_TO_QC") ||
      job.status === "QC" ||
      (canRevertStep && (REVERTIBLE_STATUSES as readonly string[]).includes(job.status))) && (
      <div className="flex flex-col gap-2 border-t border-dashed pt-2.5">
        {flowMode === null ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {mayFlow("START_WORK") && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                className="h-7 font-semibold"
                onClick={() => void flow({ action: "START_WORK" })}
              >
                <Play data-icon="inline-start" />
                {job.status === "WAITING" ? t("flow.resumeWork") : t("flow.startWork")}
              </Button>
            )}
            {mayFlow("SET_WAITING") && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-7 border-warn/50 text-warn hover:bg-warn/10"
                onClick={() => setFlowMode("waiting")}
              >
                <Clock data-icon="inline-start" />
                {job.status === "WAITING" ? t("flow.changeReason") : t("flow.setWaiting")}
              </Button>
            )}
            {mayFlow("SEND_TO_QC") && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-7 border-info/50 text-info hover:bg-info/10"
                onClick={() => void flow({ action: "SEND_TO_QC" })}
              >
                <Shield data-icon="inline-start" />
                {t("flow.sendToQc")}
              </Button>
            )}
            {job.status === "QC" && canSignOffQc && viewerStaffId !== job.assignedStaffId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-7 border-ok/50 font-semibold text-ok hover:bg-ok/10"
                onClick={() => void flow({ action: "QC_PASS" })}
              >
                <ShieldCheck data-icon="inline-start" />
                {t("flow.qcPass")}
              </Button>
            )}
            {job.status === "QC" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-7 border-bad/50 text-bad hover:bg-bad/10"
                onClick={() => setFlowMode("qcfail")}
              >
                <ShieldX data-icon="inline-start" />
                {t("flow.qcFail")}
              </Button>
            )}
            {job.status === "QC" && !canSignOffQc && (
              <span className="text-[10.5px] text-faint">{t("flow.qcManagerHint")}</span>
            )}
            {job.status === "QC" && canSignOffQc && viewerStaffId === job.assignedStaffId && (
              <span className="text-[10.5px] text-faint">{t("flow.qcOwnWorkHint")}</span>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {canCancelJob && mayFlow("CANCEL") && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setFlowMode("cancel")}
                  className="flex items-center gap-1 border border-border-strong px-2 py-0.5 text-[10.5px] text-faint hover:border-bad/50 hover:text-bad"
                >
                  <Ban className="size-3" aria-hidden />
                  {t("flow.cancel")}
                </button>
              )}
              {canRevertStep &&
                (REVERTIBLE_STATUSES as readonly string[]).includes(job.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => arm("revertStep", () => void run(() => revertJobStep(job.id)))}
                    className={cn(
                      "flex items-center gap-1 border px-2 py-0.5 text-[10.5px]",
                      armed === "revertStep"
                        ? "border-warn/60 bg-warn/15 text-warn"
                        : "border-border-strong text-faint hover:text-warn",
                    )}
                  >
                    <Undo2 className="size-3" aria-hidden />
                    {armed === "revertStep" ? t("flow.revertStepConfirm") : t("flow.revertStep")}
                  </button>
                )}
            </span>
          </div>
        ) : flowMode === "waiting" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              className={selectCls}
              value={flowReason}
              onChange={(e) => setFlowReason(e.currentTarget.value)}
              aria-label={t("flow.reasonLabel")}
            >
              {WAITING_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {twr(reason)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={busy || (job.status === "WAITING" && job.waitingReason === flowReason)}
              className="h-7 font-semibold"
              onClick={() => void flow({ action: "SET_WAITING", waitingReason: flowReason })}
            >
              {t("flow.confirm")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setFlowMode(null)}
            >
              {tc("cancel")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              value={flowNote}
              onChange={(e) => setFlowNote(e.currentTarget.value)}
              placeholder={
                flowMode === "qcfail"
                  ? t("flow.qcFailNotePlaceholder")
                  : t("flow.cancelNotePlaceholder")
              }
              autoFocus
              className="h-8 min-w-52 flex-1 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !flowNote.trim()}
              className="h-7 border-bad/50 font-semibold text-bad hover:bg-bad/10"
              onClick={() =>
                void flow({
                  action: flowMode === "qcfail" ? "QC_FAIL" : "CANCEL",
                  note: flowNote,
                })
              }
            >
              {flowMode === "qcfail" ? t("flow.qcFail") : t("flow.cancelConfirm")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setFlowMode(null)}
            >
              {tc("cancel")}
            </Button>
          </div>
        )}
      </div>
    );

  /* ---------------- per-status expanded bodies (D-7) ---------------- */

  const proposedBody = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        {canEditCore && (!job.catalogItemId || isManager) ? (
          <Input
            key={`price-${job.id}-${job.priceSatang ?? "none"}`}
            defaultValue={job.priceSatang != null ? satangToBahtInput(job.priceSatang) : ""}
            placeholder={t("pricePlaceholder")}
            inputMode="decimal"
            className="num h-8 w-28 text-right text-[13px]"
            onBlur={(e) => {
              const value = e.currentTarget.value.trim();
              const current = job.priceSatang != null ? satangToBahtInput(job.priceSatang) : "";
              if (value !== current) void run(() => updateJobPrice(job.id, value));
            }}
          />
        ) : (
          <span className={cn("num text-[15px] font-semibold", job.priceSatang == null && "text-warn")}>
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
        {canEditCore ? (
          <span className="flex flex-wrap items-center gap-1.5">
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
                    void run(() => updateJob(job.id, { payerType: "INSURER", insurerName: value }));
                  }
                }}
              />
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{payerText}</span>
        )}
        {editButton}
      </div>

      {job.priceOverriddenByName && (
        <p className="text-[10.5px] text-warn">
          {t("overriddenBy", { name: job.priceOverriddenByName })}
          {job.catalogPriceSatang != null &&
            ` · ${t("catalogPrice", { price: formatBaht(job.catalogPriceSatang) })}`}
        </p>
      )}
      {job.catalogItemId && canEditCore && !isManager && (
        <p className="text-[10.5px] text-faint">{t("priceLockedHint")}</p>
      )}

      {canEditCore && (
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
          <label className="flex items-center gap-1.5 text-[11px] text-faint">
            {t("assigneeLabel")}
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
      )}

      {findingsLine}
      {noteLine}
      {(job.partLines.length > 0 || editing || addingPart) ? partsBlock : (
        !readOnly && (
          <button
            type="button"
            onClick={() => {
              setAddingPart(true);
              setTimeout(() => addPartNameRef.current?.focus(), 0);
            }}
            className="flex w-fit items-center gap-1 text-[11px] text-faint hover:text-primary"
          >
            <Plus className="size-3" aria-hidden />
            {t("parts.add")}
          </button>
        )
      )}
      {photosBlock}

      {/* Authorization recording — an action, never behind Edit (D-7). */}
      <div className="flex flex-col gap-2 border-t border-dashed pt-2.5">
        {authHistory}
        {!readOnly && (
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
              className="h-7 w-40 text-xs"
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
        {job.priceSatang == null && !readOnly && (
          <p className="text-[10.5px] text-faint">{t("auth.needsPrice")}</p>
        )}
      </div>

      {editing && !readOnly && (
        <div className="flex items-center border-t border-dashed pt-2.5">
          <button
            type="button"
            onClick={() => arm("delete", () => void handleDelete())}
            className={cn(
              "border px-2 py-0.5 text-[10.5px]",
              armed === "delete"
                ? "border-bad/60 bg-bad/15 text-bad"
                : "border-border-strong text-faint hover:text-bad",
            )}
          >
            {armed === "delete" ? t("deleteConfirm") : t("delete")}
          </button>
        </div>
      )}
    </>
  );

  const activeBody = (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {/* A record, not a form (D-7): assignment is a field edit. */}
        {editing && !readOnly ? (
          <label className="flex items-center gap-1.5 text-[11px] text-faint">
            {t("assigneeLabel")}
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
        ) : (
          <span className="text-xs">
            <span className="text-faint">{t("assigneeLabel")} · </span>
            <span className={cn(job.assignedStaffName ? "text-foreground" : "text-faint")}>
              {job.assignedStaffName ?? t("unassigned")}
            </span>
          </span>
        )}
        <span className="num text-[13px]">{job.priceSatang != null && formatBaht(job.priceSatang)}</span>
        <span className="text-xs text-muted-foreground">{payerText}</span>
        {editButton}
      </div>

      {editing ? (
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
      ) : (
        noteLine
      )}
      {findingsLine}
      {partsBlock}
      {photosBlock}
      {transitionsBlock}

      {(job.authorizations.length > 0 || (isManager && job.status === "AUTHORIZED" && !readOnly)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed pt-2">
          {authHistory}
          {!readOnly && isManager && job.status === "AUTHORIZED" && (
            <button
              type="button"
              onClick={() => arm("revert", () => void run(() => revertAuthorization(job.id)))}
              className={cn(
                "ml-auto border px-2 py-0.5 text-[10.5px]",
                armed === "revert"
                  ? "border-warn/60 bg-warn/15 text-warn"
                  : "border-border-strong text-faint hover:text-warn",
              )}
            >
              {armed === "revert" ? t("auth.revertConfirm") : t("auth.revert")}
            </button>
          )}
        </div>
      )}
    </>
  );

  const completedBody = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <span className="num text-[15px] font-semibold">
          {job.priceSatang != null ? formatBaht(job.priceSatang) : t("unpriced")}
        </span>
        <span className="text-xs text-muted-foreground">{payerText}</span>
        {job.assignedStaffName && (
          <span className="text-xs text-muted-foreground">
            {t("byTechnician", { name: job.assignedStaffName })}
          </span>
        )}
        {editButton}
      </div>

      {editing && !readOnly ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-faint">
            {t("assigneeLabel")}
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
        noteLine
      )}
      {findingsLine}
      {partsSummaryLine}
      {photosBlock}
      {authHistory && <div className="border-t border-dashed pt-2">{authHistory}</div>}
      {transitionsBlock}
    </>
  );

  const closedBody = (() => {
    if (job.status === "CANCELLED") {
      return (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-xs text-muted-foreground">
            {t("cancelledLine", {
              when: job.cancelled
                ? format.dateTime(new Date(job.cancelled.at), { day: "numeric", month: "short" })
                : "—",
              name: job.cancelled?.byName ?? "—",
            })}
            {job.cancelled?.note && ` — “${job.cancelled.note}”`}
          </p>
          {!readOnly && canRevertStep && (
            <button
              type="button"
              onClick={() => arm("revertStep", () => void run(() => revertJobStep(job.id)))}
              className={cn(
                "ml-auto flex items-center gap-1 border px-2 py-0.5 text-[10.5px]",
                armed === "revertStep"
                  ? "border-warn/60 bg-warn/15 text-warn"
                  : "border-border-strong text-faint hover:text-warn",
              )}
            >
              <Undo2 className="size-3" aria-hidden />
              {armed === "revertStep" ? t("flow.revertStepConfirm") : t("flow.revertStep")}
            </button>
          )}
        </div>
      );
    }
    const declinedEntry = [...job.authorizations]
      .reverse()
      .find((auth) => auth.decision === "DECLINED");
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {t("declinedLine", {
            when: declinedEntry
              ? format.dateTime(new Date(declinedEntry.recordedAt), {
                  day: "numeric",
                  month: "short",
                })
              : "—",
            name: declinedEntry?.recordedByName ?? "—",
          })}
          {declinedEntry?.channel && ` · ${t(`auth.channel.${declinedEntry.channel}`)}`}
          {declinedEntry?.note && ` — “${declinedEntry.note}”`}
        </p>
        {!readOnly && isManager && (
          <button
            type="button"
            onClick={() => arm("revert", () => void run(() => revertAuthorization(job.id)))}
            className={cn(
              "ml-auto border px-2 py-0.5 text-[10.5px]",
              armed === "revert"
                ? "border-warn/60 bg-warn/15 text-warn"
                : "border-border-strong text-faint hover:text-warn",
            )}
          >
            {armed === "revert" ? t("auth.revertConfirm") : t("auth.revert")}
          </button>
        )}
      </div>
    );
  })();

  return (
    <li className="border-b last:border-b-0">
      {/* collapsed row (D-7/D-8): title · one chip · payer and price as text */}
      <button
        type="button"
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 text-left hover:bg-surface-2 sm:px-5"
        onClick={toggleExpanded}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 flex-none text-faint" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 flex-none text-faint" aria-hidden />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] font-medium",
            closed && "text-muted-foreground",
          )}
        >
          {job.title}
        </span>
        <JobStatusBadge status={job.status} waitingReason={job.waitingReason} />
        <span className="hidden text-[11px] text-faint sm:inline">{payerText}</span>
        <span
          className={cn(
            "num text-[13px]",
            job.priceSatang == null && "text-faint",
            closed && "text-faint",
          )}
        >
          {job.priceSatang == null ? t("unpriced") : formatBaht(job.priceSatang)}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-dashed bg-surface-2/40 px-4 py-3 sm:px-5">
          {job.status === "WAITING" && job.waitingReason === "PARTS" && (
            <p className="num text-[11px] text-warn">
              {t("partsRollup", { total: job.partLines.length, arrived: partsArrived })}
            </p>
          )}
          {proposed && proposedBody}
          {active && activeBody}
          {completed && completedBody}
          {closed && closedBody}

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
