"use client";

import {
  Ban,
  Camera,
  ChevronDown,
  ChevronRight,
  Clock,
  Ellipsis,
  Pencil,
  Play,
  Plus,
  Shield,
  ShieldCheck,
  ShieldX,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { JobStatusBadge } from "@/components/blocks/job-status-badge";
import { Segmented } from "@/components/blocks/segmented";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canFlow, isActiveJob, REVERTIBLE_STATUSES, WAITING_REASONS } from "@/lib/case-flow";
import { downscalePhoto } from "@/lib/downscale";
import type { AuthorizationDto, JobDto } from "@/lib/jobs";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";
import { revertJobStep, transitionJob, type FlowError } from "./flow-actions";
import {
  addJobPhoto,
  removeJobPhoto,
  revertAuthorization,
  updateJob,
  type JobError,
} from "./job-actions";
import { PartsTable, partsCostSatang, selectCls } from "./parts-table";

/**
 * Work cards and Done rows (D-23). An active card leads with exactly one
 * primary next step — Start work, Resume work, Send to QC, QC pass — and at
 * most one outline secondary beside it. Technician is a live field on the
 * card's first line; corrections live in the ⋯ menu, Manager-only ones drawn
 * faint for everyone else; the three interruptions that need input — Set
 * waiting, QC fail, Cancel job — are small dialogs asking exactly what the
 * server requires. Done rows are one line each: Completed is a receipt,
 * Declined and Cancelled carry date, channel and note with their Manager
 * reverts in ⋯. `transitionJob` and `revertJobStep` are unchanged from M5.
 */

export type JobCardProps = {
  caseId: string;
  job: JobDto;
  staffOptions: { id: string; name: string }[];
  isManager: boolean;
  canSignOffQc: boolean;
  canCancelJob: boolean;
  canRevertStep: boolean;
  viewerStaffId: string;
  readOnly: boolean;
  onChanged: (dto: JobDto) => void;
};

type CardError = JobError | FlowError;
type CardResult = { ok: true; value: JobDto } | { ok: false; error: CardError };

export function JobCard(props: JobCardProps) {
  if (isActiveJob(props.job.status) && !props.readOnly) return <WorkCard {...props} />;
  return <DoneRow {...props} />;
}

/* ------------------------------------------------------------------ */
/* Shared quiet fragments.                                             */
/* ------------------------------------------------------------------ */

function useProvenance() {
  const t = useTranslations("jobs");
  const format = useFormatter();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { day: "numeric", month: "short" });
  /** "Authorized Sep 2 · LINE · Q-1031 · name" from the latest decisive entry. */
  const authorizedLine = (authorizations: AuthorizationDto[]) => {
    const entry = [...authorizations].reverse().find((auth) => auth.decision === "AUTHORIZED");
    if (!entry) return null;
    return [
      t("work.authorizedOn", { date: date(entry.recordedAt) }),
      entry.channel ? t(`auth.channel.${entry.channel}`) : null,
      entry.quotationLabel,
      entry.recordedByName,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  return { date, authorizedLine };
}

function FindingChips({ caseId, job }: { caseId: string; job: JobDto }) {
  const t = useTranslations("jobs");
  const ti = useTranslations("inspection");
  if (job.findings.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-faint">{t("offer.fulfils")}</span>
      {job.findings.map((f) => (
        <Link
          key={f.id}
          href={`/cases/${caseId}/inspection`}
          className="border border-border-strong px-1.5 py-px text-muted-foreground hover:border-primary-dim hover:text-primary"
        >
          {f.zone ? ti(`zones.${f.zone}` as never) : ti(`checklist.${f.checklistItem}` as never)}
        </Link>
      ))}
    </span>
  );
}

function PhotoStrip({
  job,
  canAdd,
  canRemove,
  busy,
  onAdd,
  onRemove,
  inputRef,
}: {
  job: JobDto;
  canAdd: boolean;
  canRemove: boolean;
  busy: boolean;
  onAdd: (files: FileList | null) => void;
  onRemove: (photoId: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations("jobs");
  if (job.photos.length === 0 && !canAdd) return null;
  return (
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
          {canRemove && (
            <button
              type="button"
              onClick={() => onRemove(photo.id)}
              className="absolute -right-1.5 -top-1.5 hidden size-4 items-center justify-center border bg-background text-[10px] text-faint hover:text-bad group-hover:flex"
              aria-label={t("removePhoto")}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {canAdd && (
        <label
          className={cn(
            "flex h-11 cursor-pointer items-center gap-1 border border-dashed px-2 text-[11px] text-faint hover:border-primary-dim hover:text-primary",
            busy && "animate-pulse",
          )}
        >
          <Camera className="size-3.5" aria-hidden />
          {t("addPhoto")}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              onAdd(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The Work card.                                                      */
/* ------------------------------------------------------------------ */

function WorkCard({
  caseId,
  job,
  staffOptions,
  isManager,
  canSignOffQc,
  canCancelJob,
  canRevertStep,
  viewerStaffId,
  onChanged,
}: JobCardProps) {
  const t = useTranslations("jobs");
  const tc = useTranslations("common");
  const twr = useTranslations("waitingReasons");
  const format = useFormatter();
  const { authorizedLine } = useProvenance();
  const [expanded, setExpanded] = useState(true); // active cards start expanded (D-23)
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CardError | null>(null);
  const [dialog, setDialog] = useState<null | "waiting" | "qcfail" | "cancel">(null);
  const [reason, setReason] = useState<(typeof WAITING_REASONS)[number]>(job.waitingReason ?? "PARTS");
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState<null | "revertStep" | "revertAuth">(null);
  const [addPartNonce, setAddPartNonce] = useState(0);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const mayFlow = (action: Parameters<typeof canFlow>[0]) => canFlow(action, job.status);
  const waiting = job.status === "WAITING";
  const payerText =
    job.payerType === "CUSTOMER" ? t("payer.CUSTOMER") : (job.insurerName ?? t("payer.INSURER"));

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

  async function flow(input: { action: string; waitingReason?: string; note?: string }) {
    await run(() => transitionJob(job.id, input));
    setDialog(null);
    setNote("");
  }

  function arm(kind: "revertStep" | "revertAuth", go: () => void) {
    if (armed !== kind) {
      setArmed(kind);
      setTimeout(() => setArmed((cur) => (cur === kind ? null : cur)), 3000);
      return;
    }
    setArmed(null);
    go();
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

  /* The waiting blocker leads the card (D-23). */
  const partsPending = job.partLines.filter((line) => line.orderStatus !== "ARRIVED");
  const nextDue = [...partsPending]
    .filter((line) => line.etaDate)
    .sort((a, b) => a.etaDate!.localeCompare(b.etaDate!))[0];
  const blockerLine = waiting && (
    <p className="flex items-center gap-1.5 text-[12px] text-warn">
      <Clock className="size-3.5 flex-none" aria-hidden />
      {job.waitingReason === "PARTS" && job.partLines.length > 0
        ? nextDue
          ? t("work.waitingPartsDue", {
              arrived: job.partLines.length - partsPending.length,
              total: job.partLines.length,
              name: nextDue.name,
              date: format.dateTime(new Date(`${nextDue.etaDate}T00:00:00`), {
                day: "numeric",
                month: "short",
              }),
            })
          : t("work.waitingParts", {
              arrived: job.partLines.length - partsPending.length,
              total: job.partLines.length,
            })
        : t("work.waitingReason", { reason: twr(job.waitingReason ?? "OTHER") })}
    </p>
  );

  /* The one primary and its outline secondary, per status (D-23). */
  const qcOwnWork = job.status === "QC" && viewerStaffId === job.assignedStaffId;
  const actionRow = (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed pt-2.5">
      {mayFlow("START_WORK") && (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          className="h-8 font-semibold"
          onClick={() => void flow({ action: "START_WORK" })}
        >
          <Play data-icon="inline-start" />
          {waiting ? t("flow.resumeWork") : t("flow.startWork")}
        </Button>
      )}
      {mayFlow("SEND_TO_QC") && (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          className="h-8 font-semibold"
          onClick={() => void flow({ action: "SEND_TO_QC" })}
        >
          <Shield data-icon="inline-start" />
          {t("flow.sendToQc")}
        </Button>
      )}
      {job.status === "QC" && canSignOffQc && !qcOwnWork && (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          className="h-8 font-semibold"
          onClick={() => void flow({ action: "QC_PASS" })}
        >
          <ShieldCheck data-icon="inline-start" />
          {t("flow.qcPass")}
        </Button>
      )}
      {mayFlow("SET_WAITING") && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          className="h-8"
          onClick={() => {
            setReason(job.waitingReason ?? "PARTS");
            setDialog("waiting");
          }}
        >
          <Clock data-icon="inline-start" />
          {waiting ? t("flow.changeReason") : t("work.waiting")}
        </Button>
      )}
      {job.status === "QC" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          className="h-8 border-bad/50 text-bad hover:bg-bad/10 hover:text-bad"
          onClick={() => setDialog("qcfail")}
        >
          <ShieldX data-icon="inline-start" />
          {t("flow.qcFail")}
        </Button>
      )}
      {job.status === "QC" && (!canSignOffQc || qcOwnWork) && (
        <span className="ml-auto text-[10.5px] text-faint">
          {qcOwnWork ? t("flow.qcOwnWorkHint") : t("work.qcManagerHint")}
        </span>
      )}
    </div>
  );

  const revertible = (REVERTIBLE_STATUSES as readonly string[]).includes(job.status);
  const menuItemCls = (allowed: boolean) => cn(!allowed && "text-faint");

  return (
    <li className="border-b border-dashed last:border-b-0">
      {/* collapsed row: chevron · title · one chip · technician · price */}
      <button
        type="button"
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 text-left hover:bg-surface-2 sm:px-5"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 flex-none text-faint" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 flex-none text-faint" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{job.title}</span>
        <JobStatusBadge status={job.status} waitingReason={job.waitingReason} />
        <span
          className={cn(
            "hidden w-24 truncate text-right text-[11px] sm:inline",
            job.assignedStaffName ? "text-faint" : "text-warn/80",
          )}
        >
          {job.assignedStaffName ?? t("unassigned")}
        </span>
        <span className="num w-20 text-right text-[13px]">
          {job.priceSatang != null ? formatBaht(job.priceSatang) : ""}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-dashed bg-surface-2/40 px-4 py-3 sm:px-5">
          {blockerLine}

          {/* the first line: technician is live (D-23) · price · payer · ⋯ */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-faint">
              {t("work.technician")}
              <select
                className={cn(
                  selectCls,
                  "h-7 min-w-36",
                  !job.assignedStaffId && "border-warn/50 text-warn",
                )}
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
            {job.priceSatang != null && (
              <span className="num text-[13px]">{formatBaht(job.priceSatang)}</span>
            )}
            <span className="text-[11px] text-muted-foreground">{payerText}</span>

            <DropdownMenu>
              <DropdownMenuTrigger
                className="ml-auto flex size-7 items-center justify-center border border-border-strong text-muted-foreground hover:border-primary-dim hover:text-primary aria-expanded:border-primary aria-expanded:text-primary"
                aria-label={t("work.more")}
              >
                <Ellipsis className="size-3.5" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-48 border border-border-strong bg-popover text-xs shadow-none ring-0"
              >
                <DropdownMenuItem onSelect={() => setEditing((v) => !v)}>
                  <Pencil className="size-3.5 text-faint" aria-hidden />
                  {editing ? t("editDone") : t("work.editDetails")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAddPartNonce((n) => n + 1)}>
                  <Plus className="size-3.5 text-faint" aria-hidden />
                  {t("parts.add")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => photoInputRef.current?.click()}>
                  <Camera className="size-3.5 text-faint" aria-hidden />
                  {t("addPhoto")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canCancelJob || !mayFlow("CANCEL")}
                  title={!canCancelJob ? t("errors.forbidden") : undefined}
                  className={cn(menuItemCls(canCancelJob), canCancelJob && "text-bad focus:text-bad")}
                  onSelect={() => setDialog("cancel")}
                >
                  <Ban className="size-3.5" aria-hidden />
                  {t("flow.cancel")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canRevertStep || !revertible}
                  className={menuItemCls(canRevertStep)}
                  onSelect={(e) => {
                    e.preventDefault();
                    arm("revertStep", () => void run(() => revertJobStep(job.id)));
                  }}
                >
                  <Undo2 className="size-3.5 text-faint" aria-hidden />
                  {armed === "revertStep" ? t("flow.revertStepConfirm") : t("flow.revertStep")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!isManager || job.status !== "AUTHORIZED"}
                  className={menuItemCls(isManager)}
                  onSelect={(e) => {
                    e.preventDefault();
                    arm("revertAuth", () => void run(() => revertAuthorization(job.id)));
                  }}
                >
                  <Undo2 className="size-3.5 text-faint" aria-hidden />
                  {armed === "revertAuth" ? t("auth.revertConfirm") : t("auth.revert")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {editing ? (
            <textarea
              key={`note-${job.id}-${job.note ?? ""}`}
              defaultValue={job.note ?? ""}
              placeholder={t("notePlaceholder")}
              rows={1}
              autoFocus
              onBlur={(e) => {
                const value = e.currentTarget.value.trim();
                if (value !== (job.note ?? "")) void run(() => updateJob(job.id, { note: value }));
              }}
              className="w-full resize-y border border-dashed bg-transparent px-2 py-1 text-xs placeholder:text-faint focus:border-primary focus:outline-none"
            />
          ) : (
            job.note && <p className="text-xs text-muted-foreground">“{job.note}”</p>
          )}

          <FindingChips caseId={caseId} job={job} />

          {/* the M7.5 parts table, unchanged; under the blocker line when Waiting */}
          <PartsTable
            job={job}
            rowsEditable={editing}
            statusLive
            canAdd
            addNonce={addPartNonce}
            onChanged={onChanged}
            onError={setError}
          />

          <PhotoStrip
            job={job}
            canAdd
            canRemove={editing}
            busy={busy}
            onAdd={(files) => void handleAddPhotos(files)}
            onRemove={(photoId) => void run(() => removeJobPhoto(photoId))}
            inputRef={photoInputRef}
          />

          {actionRow}

          {authorizedLine(job.authorizations) && (
            <p className="text-[11px] text-faint">{authorizedLine(job.authorizations)}</p>
          )}

          {error && (
            <p role="alert" className="border border-bad/45 px-2 py-1 text-[11px] text-bad">
              {t(`errors.${error}` as never)}
            </p>
          )}
        </div>
      )}

      {/* the small dialogs (D-23): exactly what the server requires */}
      <Dialog open={dialog === "waiting"} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog === "waiting" && (
          <DialogContent width="sm" title={t("work.dialogs.waitingTitle")} description={t("flow.reasonLabel")}>
            <DialogBody>
              <Segmented
                aria-label={t("flow.reasonLabel")}
                value={reason}
                onChange={setReason}
                className="flex-wrap"
                options={WAITING_REASONS.map((option) => ({ value: option, label: twr(option) }))}
              />
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                size="sm"
                disabled={busy || (waiting && job.waitingReason === reason)}
                className="h-8 font-semibold"
                onClick={() => void flow({ action: "SET_WAITING", waitingReason: reason })}
              >
                {t("flow.confirm")}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setDialog(null)}>
                {tc("cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog
        open={dialog === "qcfail" || dialog === "cancel"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setNote("");
          }
        }}
      >
        {(dialog === "qcfail" || dialog === "cancel") && (
          <DialogContent
            width="sm"
            title={dialog === "qcfail" ? t("work.dialogs.qcFailTitle") : t("work.dialogs.cancelTitle")}
            description={dialog === "qcfail" ? t("work.dialogs.qcFailHint") : t("work.dialogs.cancelHint")}
          >
            <DialogBody>
              <textarea
                value={note}
                onChange={(e) => setNote(e.currentTarget.value)}
                placeholder={
                  dialog === "qcfail" ? t("flow.qcFailNotePlaceholder") : t("flow.cancelNotePlaceholder")
                }
                rows={3}
                autoFocus
                className="w-full resize-y border bg-background px-2.5 py-2 text-[13px] leading-relaxed placeholder:text-faint focus:border-primary focus:outline-none"
              />
              <p className="text-[10.5px] text-faint">
                {dialog === "qcfail" ? t("work.dialogs.qcFailHint") : t("work.dialogs.cancelHint")}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !note.trim()}
                className="h-8 border-bad/50 font-semibold text-bad hover:bg-bad/10 hover:text-bad"
                onClick={() =>
                  void flow({ action: dialog === "qcfail" ? "QC_FAIL" : "CANCEL", note })
                }
              >
                {dialog === "qcfail" ? (
                  <ShieldX data-icon="inline-start" />
                ) : (
                  <Ban data-icon="inline-start" />
                )}
                {dialog === "qcfail" ? t("work.dialogs.qcFailConfirm") : t("flow.cancelConfirm")}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setDialog(null)}>
                {tc("cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Done rows (D-23): one line each.                                    */
/* ------------------------------------------------------------------ */

function DoneRow({
  caseId,
  job,
  isManager,
  canRevertStep,
  readOnly,
  onChanged,
}: JobCardProps) {
  const t = useTranslations("jobs");
  const { date, authorizedLine } = useProvenance();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CardError | null>(null);
  const [armed, setArmed] = useState(false);

  const completed = job.status === "COMPLETED";
  const declined = job.status === "DECLINED";
  const cancelled = job.status === "CANCELLED";

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

  function arm(go: () => void) {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3000);
      return;
    }
    setArmed(false);
    go();
  }

  const declinedEntry = declined
    ? [...job.authorizations].reverse().find((auth) => auth.decision === "DECLINED")
    : undefined;

  /** The one-line detail beside the chip: date · channel/by — “note”. */
  const detail = declined
    ? declinedEntry
      ? [
          date(declinedEntry.recordedAt),
          declinedEntry.channel ? t(`auth.channel.${declinedEntry.channel}`) : null,
        ]
          .filter(Boolean)
          .join(" · ") + (declinedEntry.note ? ` — “${declinedEntry.note}”` : "")
      : null
    : cancelled
      ? job.cancelled
        ? `${date(job.cancelled.at)} · ${job.cancelled.byName}` +
          (job.cancelled.note ? ` — “${job.cancelled.note}”` : "")
        : null
      : null;

  const revertItem =
    !readOnly && (declined || cancelled) ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex size-6 flex-none items-center justify-center text-faint hover:text-primary aria-expanded:text-primary"
          aria-label={t("work.more")}
        >
          <Ellipsis className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-48 border border-border-strong bg-popover text-xs shadow-none ring-0"
        >
          {declined && (
            <DropdownMenuItem
              disabled={!isManager}
              className={cn(!isManager && "text-faint")}
              onSelect={(e) => {
                e.preventDefault();
                arm(() => void run(() => revertAuthorization(job.id)));
              }}
            >
              <Undo2 className="size-3.5 text-faint" aria-hidden />
              {armed ? t("auth.revertConfirm") : t("auth.revert")}
            </DropdownMenuItem>
          )}
          {cancelled && (
            <DropdownMenuItem
              disabled={!canRevertStep}
              className={cn(!canRevertStep && "text-faint")}
              onSelect={(e) => {
                e.preventDefault();
                arm(() => void run(() => revertJobStep(job.id)));
              }}
            >
              <Undo2 className="size-3.5 text-faint" aria-hidden />
              {armed ? t("flow.revertStepConfirm") : t("flow.revertStep")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <li className="border-b border-dashed last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2 sm:px-5">
        {completed ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={job.title}
            className="flex size-5 flex-none items-center justify-center text-faint hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="size-5 flex-none" />
        )}
        <button
          type="button"
          onClick={() => completed && setExpanded((v) => !v)}
          className={cn(
            "min-w-0 flex-1 truncate text-left text-[13px] font-medium",
            !completed && "cursor-default text-muted-foreground",
            completed && "hover:text-primary",
          )}
        >
          {job.title}
        </button>
        <JobStatusBadge status={job.status} waitingReason={job.waitingReason} />
        {completed && job.assignedStaffName && (
          <span className="hidden w-24 truncate text-right text-[11px] text-faint sm:inline">
            {job.assignedStaffName}
          </span>
        )}
        {detail && (
          <span className="min-w-0 flex-[2] truncate text-right text-[11px] text-muted-foreground" title={detail}>
            {detail}
          </span>
        )}
        {!cancelled && (
          <span className={cn("num w-20 text-right text-[13px]", !completed && "text-faint")}>
            {job.priceSatang != null ? formatBaht(job.priceSatang) : ""}
          </span>
        )}
        {revertItem}
      </div>

      {/* the receipt (D-23): fulfils, parts cost, photos, QC and authorization provenance */}
      {completed && expanded && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed bg-surface-2/40 px-4 py-2.5 text-[11px] text-muted-foreground sm:px-5 sm:pl-12">
          <FindingChips caseId={caseId} job={job} />
          {job.partLines.length > 0 && (
            <span className="num">
              {t("done.partsCost", {
                count: job.partLines.length,
                cost: formatBaht(partsCostSatang(job)),
              })}
            </span>
          )}
          {job.note && <span>“{job.note}”</span>}
          <PhotoStrip
            job={job}
            canAdd={false}
            canRemove={false}
            busy={false}
            onAdd={() => undefined}
            onRemove={() => undefined}
          />
          <span className="basis-full text-faint">
            {[
              job.qcPassed
                ? t("done.qcPassed", { date: date(job.qcPassed.at), name: job.qcPassed.byName })
                : null,
              authorizedLine(job.authorizations),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="mx-4 mb-2 border border-bad/45 px-2 py-1 text-[11px] text-bad sm:mx-5">
          {t(`errors.${error}` as never)}
        </p>
      )}
    </li>
  );
}
