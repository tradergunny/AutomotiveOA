"use client";

import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { JobRollupLine } from "@/components/blocks/job-rollup";
import { Dialog } from "@/components/ui/dialog";
import { isActiveJob } from "@/lib/case-flow";
import {
  offerNeedsSending,
  offerParts,
  type JobDto,
  type OfferPart,
  type QuotationDto,
} from "@/lib/jobs";
import type { SentUpdateDto } from "@/lib/line-send";
import { formatBaht } from "@/lib/money";
import { AddJobDialog } from "./add-job-dialog";
import type { SendBlockedReason } from "./customer-timeline";
import { JobCard } from "./job-card";
import { useJobsFlow } from "./jobs-flow-context";
import { OfferTable } from "./offer-table";
import { RecordResponseDialog } from "./record-response-dialog";
import { SendQuotationDialog } from "./send-quotation-dialog";

/**
 * The case page's Jobs section, organized by phase (D-19): Offer → Work →
 * Done in one fixed order, mirroring the header spine. Offer holds every
 * Proposed line with the set-level tooling at its foot; Work holds the
 * active Jobs as cards, each leading with one primary next step; Done holds
 * Completed, Declined and Cancelled as one-line records. A phase with no
 * members renders nothing, and phase headings appear only when two or more
 * phases have members. The section header carries "Jobs" and the count; the
 * per-status rollup is each phase's sub-line. Client state holds jobs and
 * quotations and reconciles with what server actions return; the header's
 * next-action strip reaches in through JobsFlowProvider (D-22).
 */

type Props = {
  caseId: string;
  initialJobs: JobDto[];
  initialQuotations: QuotationDto[]; // newest first
  catalogItems: { id: string; name: string; priceSatang: number }[];
  staffOptions: { id: string; name: string }[];
  isManager: boolean;
  canSignOffQc: boolean;
  canCancelJob: boolean;
  canRevertStep: boolean;
  viewerStaffId: string;
  readOnly: boolean;
  /** The LINE gate, for Send quotation's explanations. */
  blockedReason: SendBlockedReason;
  recipientName: string;
  /** Set on a delivered case — the section reads as a closed record. */
  deliveredAt: string | null;
  onUpdateSent?: (update: SentUpdateDto) => void;
};

type DialogState =
  | null
  | { kind: "add" }
  | { kind: "send"; part: OfferPart | null }
  | { kind: "respond"; part: OfferPart | null };

export function JobsPanel({
  caseId,
  initialJobs,
  initialQuotations,
  catalogItems,
  staffOptions,
  isManager,
  canSignOffQc,
  canCancelJob,
  canRevertStep,
  viewerStaffId,
  readOnly,
  blockedReason,
  recipientName,
  deliveredAt,
}: Props) {
  const t = useTranslations("jobs");
  const format = useFormatter();
  const { request } = useJobsFlow();

  const [jobs, setJobs] = useState(initialJobs);
  const [quotations, setQuotations] = useState(initialQuotations);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  /* ---------- the header reaches in (D-22) ---------- */

  // Each request is answered exactly once, as state adjusted during render
  // on a changed nonce — no effect, no cascading re-render.
  const [answeredNonce, setAnsweredNonce] = useState(0);
  if (request && request.nonce !== answeredNonce) {
    setAnsweredNonce(request.nonce);
    if (request.action === "SET_PRICES") setFocusNonce((n) => n + 1);
    else if (request.action === "SEND_QUOTATION") setDialog({ kind: "send", part: null });
    else if (request.action === "RECORD_RESPONSE") setDialog({ kind: "respond", part: null });
  }

  /* ---------- state reconciliation ---------- */

  const jobChanged = (dto: JobDto) =>
    setJobs((list) => list.map((job) => (job.id === dto.id ? dto : job)));
  const jobsChanged = (dtos: JobDto[]) =>
    setJobs((list) => list.map((job) => dtos.find((dto) => dto.id === job.id) ?? job));
  const jobAdded = (dto: JobDto) => setJobs((list) => [...list, dto]);
  const jobDeleted = (jobId: string) => setJobs((list) => list.filter((job) => job.id !== jobId));
  const jobsMerged = (survivor: JobDto, absorbedIds: string[]) =>
    setJobs((list) =>
      list
        .filter((job) => !absorbedIds.includes(job.id))
        .map((job) => (job.id === survivor.id ? survivor : job)),
    );
  const quotationStamped = (quotation: QuotationDto) =>
    setQuotations((list) => {
      const rest = list.filter((q) => q.id !== quotation.id);
      return [quotation, ...rest].sort((a, b) => b.version - a.version);
    });

  /* ---------- phases (D-19) ---------- */

  const phases = useMemo(() => {
    const offer = jobs.filter((job) => job.status === "PROPOSED");
    const work = jobs.filter((job) => isActiveJob(job.status));
    const done = jobs.filter(
      (job) => job.status === "COMPLETED" || job.status === "DECLINED" || job.status === "CANCELLED",
    );
    return { offer, work, done };
  }, [jobs]);
  const populated = [phases.offer, phases.work, phases.done].filter((list) => list.length > 0).length;
  const showHeadings = !readOnly && populated >= 2;

  const offerTotal = phases.offer.reduce((sum, job) => sum + (job.priceSatang ?? 0), 0);
  const offerUnpriced = phases.offer.filter((job) => job.priceSatang == null).length;
  const sendPrimary = offerNeedsSending(jobs, quotations);
  const parts = offerParts(jobs);
  const insurerName = jobs.find((job) => job.insurerName)?.insurerName ?? null;

  const rollup = (list: JobDto[]) =>
    list.map((job) => ({ status: job.status, waitingReason: job.waitingReason }));

  const phaseHead = (title: string, sub: React.ReactNode) =>
    showHeadings ? (
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-4 pt-2.5 pb-1 sm:px-5">
        <span className="text-[12px] font-medium">{title}</span>
        <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted-foreground">
          {sub}
        </span>
      </div>
    ) : null;

  const cardProps = {
    caseId,
    staffOptions,
    isManager,
    canSignOffQc,
    canCancelJob,
    canRevertStep,
    viewerStaffId,
    readOnly,
    onChanged: jobChanged,
  };

  return (
    <section id="jobs" className="relative scroll-mt-16 border bg-card">
      <CornerTicks />
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-dashed px-4 py-2.5 sm:px-5">
        <h3 className="text-[13px] font-semibold">{t("sectionTitle")}</h3>
        <span className="num text-[11px] text-faint">{jobs.length}</span>
        {readOnly && deliveredAt && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {t("deliveredLine", {
              date: format.dateTime(new Date(deliveredAt), { day: "numeric", month: "short" }),
            })}
          </span>
        )}
      </header>

      {jobs.length === 0 ? (
        <p className="px-4 py-4 text-xs text-faint sm:px-5">
          {readOnly ? t("emptyReadOnly") : t("empty")}
        </p>
      ) : readOnly ? (
        /* A Delivered case: Done rows alone — no heading, no controls (D-19). */
        <ul>
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} {...cardProps} />
          ))}
        </ul>
      ) : (
        <>
          {phases.offer.length > 0 && (
            <div>
              {phaseHead(
                t("phase.offer"),
                <>
                  <span>{t("phaseSub.jobs", { count: phases.offer.length })}</span>
                  {offerTotal > 0 && (
                    <span className="num">· {t("phaseSub.proposed", { amount: formatBaht(offerTotal) })}</span>
                  )}
                  {offerUnpriced > 0 && (
                    <span className="text-warn">· {t("phaseSub.unpriced", { count: offerUnpriced })}</span>
                  )}
                </>,
              )}
              <OfferTable
                caseId={caseId}
                jobs={phases.offer}
                quotations={quotations}
                staffOptions={staffOptions}
                isManager={isManager}
                readOnly={readOnly}
                sendPrimary={sendPrimary}
                focusNonce={focusNonce}
                onChanged={jobChanged}
                onDeleted={jobDeleted}
                onMerged={jobsMerged}
                onAddJob={() => setDialog({ kind: "add" })}
                onSend={(part) => setDialog({ kind: "send", part })}
                onRespond={(part) => setDialog({ kind: "respond", part })}
              />
            </div>
          )}

          {phases.work.length > 0 && (
            <div className={phases.offer.length > 0 ? "border-t" : undefined}>
              {phaseHead(
                t("phase.work"),
                <>
                  <span>{t("phaseSub.jobs", { count: phases.work.length })}</span>
                  <span>·</span>
                  <JobRollupLine jobs={rollup(phases.work)} />
                </>,
              )}
              <ul className={showHeadings ? "border-t border-dashed" : undefined}>
                {phases.work.map((job) => (
                  <JobCard key={job.id} job={job} {...cardProps} />
                ))}
              </ul>
            </div>
          )}

          {phases.done.length > 0 && (
            <div className={populated > 1 ? "border-t" : undefined}>
              {phaseHead(t("phase.done"), <JobRollupLine jobs={rollup(phases.done)} />)}
              <ul className={showHeadings ? "border-t border-dashed" : undefined}>
                {phases.done.map((job) => (
                  <JobCard key={job.id} job={job} {...cardProps} />
                ))}
              </ul>
            </div>
          )}

          {/* An Offer with nothing in it yet still offers Add job. */}
          {phases.offer.length === 0 && (
            <div className="flex items-center border-t border-dashed px-4 py-2 sm:px-5">
              <button
                type="button"
                onClick={() => setDialog({ kind: "add" })}
                className="text-[11px] text-faint hover:text-primary"
              >
                + {t("offer.addJob")}
              </button>
            </div>
          )}
        </>
      )}

      {/* the dialogs (D-22, D-20, D-25) */}
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog?.kind === "add" && (
          <AddJobDialog
            caseId={caseId}
            catalogItems={catalogItems}
            defaultInsurerName={insurerName}
            onAdded={jobAdded}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === "send" && (
          <SendQuotationDialog
            caseId={caseId}
            jobs={jobs}
            quotations={quotations}
            parts={parts}
            initialPart={dialog.part}
            blockedReason={blockedReason}
            recipientName={recipientName}
            onSent={(quotation) => quotationStamped(quotation)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === "respond" && (
          <RecordResponseDialog
            caseId={caseId}
            jobs={jobs}
            quotations={quotations}
            parts={parts}
            initialPart={dialog.part}
            onSaved={jobsChanged}
            onClose={() => setDialog(null)}
          />
        )}
      </Dialog>
    </section>
  );
}
