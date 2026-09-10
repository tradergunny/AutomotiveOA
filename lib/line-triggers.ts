import type {
  JobStatus,
  LineUpdateKind,
  RepairCaseStatus,
  WaitingReason,
} from "@/lib/generated/prisma/enums";
import type { JobFlowAction } from "@/lib/case-flow";

/**
 * Trigger derivation for the system-sent Progress notices and the Ready
 * Milestone (M7.10, ADR-007, CONTEXT.md Progress notice). Pure: the flow
 * actions snapshot the case before and after their transaction, then ask
 * this module what the customer should hear. Nothing here sends; nothing
 * here reads the database.
 *
 * The never-list is closed: a QC bounce, a revert, a cancellation, a price
 * change, a Paint-booth / Technician / Other wait, a waiting-reason change,
 * a Job merely starting (the second one), and anything on a Delivered case
 * all yield []. Adding a kind is a CONTEXT.md change, never a rule here.
 *
 * Two readings this module fixes, because the brief left them implicit:
 *
 * - The "Stage" the customer hears about is the WORK stage — Waiting, In
 *   progress, In QC — ignoring an undecided Proposed line beside the work.
 *   The board's attention-first precedence (a Proposed line files the case
 *   under Awaiting authorization) is about what the desk must do, not what
 *   the car is doing; suppressing "final quality check" because an upsell
 *   line is still unanswered would leave the customer with a Ready and no
 *   story before it.
 * - A QC pass that leaves the case in final check (every remaining active
 *   Job is in QC) is silent: the customer was just told "final quality
 *   check", Ready is next, and the Ready message carries the finished work's
 *   photos (CONTEXT.md Photo). JOB_COMPLETED is the notice for a Job
 *   finished while other work is still open — evidence in the middle of a
 *   long visit — which is also why the brief's two-Job walk ends
 *   WORK_STARTED, WAITING_PARTS, PARTS_ARRIVED, IN_QC, READY.
 */

export type TriggerJob = {
  id: string;
  status: JobStatus;
  waitingReason: WaitingReason | null;
};

export type CaseSnapshot = {
  caseStatus: RepairCaseStatus;
  jobs: TriggerJob[];
};

export type TriggerAct =
  | { kind: "JOB_FLOW"; action: JobFlowAction; jobId: string }
  | { kind: "REVERT"; jobId: string }
  | { kind: "MARK_READY" };

/**
 * What the case has already been told — every LineUpdate row regardless of
 * delivery status: a NOT_SENT or FAILED row is still the record that the
 * act happened, and the free-form dialog is the retry (ADR-007).
 */
export type SendHistory = {
  /** Kinds of every row on the case. */
  kinds: LineUpdateKind[];
  /** The most recent row's kind — the last thing the customer was told. */
  lastKind: LineUpdateKind | null;
  /** sentAt of the most recent JOB_COMPLETED row, for the coalescing window. */
  lastJobCompletedAt: Date | null;
};

export type TriggerInput = {
  before: CaseSnapshot;
  after: CaseSnapshot;
  act: TriggerAct;
  history: SendHistory;
  now: Date;
};

export type NoticeKind = Extract<
  LineUpdateKind,
  "WORK_STARTED" | "WAITING_PARTS" | "PARTS_ARRIVED" | "JOB_COMPLETED" | "IN_QC" | "READY"
>;

/** Jobs completing within this window of the last completion notice coalesce into it. */
export const JOB_COMPLETED_COALESCE_MS = 60 * 60 * 1000;

/** The work stage the customer hears about: active work only, Waiting first. */
type WorkStage = "WAITING" | "IN_PROGRESS" | "IN_QC" | null;

function workStageOf(jobs: TriggerJob[]): WorkStage {
  if (jobs.some((job) => job.status === "WAITING")) return "WAITING";
  if (jobs.some((job) => job.status === "IN_PROGRESS")) return "IN_PROGRESS";
  if (jobs.some((job) => job.status === "QC")) return "IN_QC";
  return null;
}

/** Whether any Job has ever been worked on: in progress now, in QC, or done. */
function workUnderway(jobs: TriggerJob[]): boolean {
  return jobs.some(
    (job) => job.status === "IN_PROGRESS" || job.status === "QC" || job.status === "COMPLETED",
  );
}

function jobIn(snapshot: CaseSnapshot, jobId: string): TriggerJob | null {
  return snapshot.jobs.find((job) => job.id === jobId) ?? null;
}

/**
 * The kinds to send for one act, in order. In practice at most one: the
 * rules below are mutually exclusive per act, and Ready subsumes the
 * completion that produced it.
 */
export function noticesFor(input: TriggerInput): NoticeKind[] {
  const { before, after, act, history, now } = input;

  // The work record is frozen; nothing about it can be news.
  if (after.caseStatus === "DELIVERED") return [];

  // Reverts are corrections of the internal narrative, never news.
  if (act.kind === "REVERT") return [];

  const out: NoticeKind[] = [];

  // READY — case status entering READY from ANY act (Mark ready, the pass
  // that completed the last Job, the cancellation that left only finished
  // work). A second Ready after a revocation is correct: told, reopened,
  // ready again.
  const enteredReady = before.caseStatus !== "READY" && after.caseStatus === "READY";

  if (act.kind === "MARK_READY") {
    return enteredReady ? ["READY"] : [];
  }

  const jobBefore = jobIn(before, act.jobId);
  const jobAfter = jobIn(after, act.jobId);
  if (!jobBefore || !jobAfter || jobBefore.status === jobAfter.status) {
    // A no-op or a reason change (WAITING → WAITING) — nothing happened to
    // the car that the customer would want to hear.
    return enteredReady ? ["READY"] : [];
  }

  const stageBefore = workStageOf(before.jobs);
  const stageAfter = workStageOf(after.jobs);

  switch (act.action) {
    case "START_WORK": {
      const endedPartsWait = jobBefore.status === "WAITING" && jobBefore.waitingReason === "PARTS";
      if (endedPartsWait) {
        // "Parts arrived, work resumed" — and when this is also the first
        // start on the case, it is the one message that closes the loop
        // the WAITING_PARTS notice opened; WORK_STARTED is not sent beside it.
        out.push("PARTS_ARRIVED");
      } else if (
        !workUnderway(before.jobs) &&
        !history.kinds.includes("WORK_STARTED") &&
        !history.kinds.includes("PARTS_ARRIVED")
      ) {
        out.push("WORK_STARTED");
      }
      break;
    }
    case "SET_WAITING": {
      if (jobAfter.waitingReason === "PARTS" && stageBefore !== "WAITING" && stageAfter === "WAITING") {
        out.push("WAITING_PARTS");
      }
      break;
    }
    case "SEND_TO_QC": {
      // Stage entry to In QC: every remaining active Job is in final check —
      // unless "final quality check" was the last thing said (a bounce and
      // its re-entry stay silent together).
      if (stageBefore !== "IN_QC" && stageAfter === "IN_QC" && history.lastKind !== "IN_QC") {
        out.push("IN_QC");
      }
      break;
    }
    case "QC_PASS": {
      if (enteredReady) break; // READY subsumes the completion
      const inFinalCheck = stageAfter === "IN_QC" || stageAfter === null;
      if (inFinalCheck) break; // Ready is next and carries the work
      const recent =
        history.lastJobCompletedAt !== null &&
        now.getTime() - history.lastJobCompletedAt.getTime() < JOB_COMPLETED_COALESCE_MS;
      if (!recent) out.push("JOB_COMPLETED");
      break;
    }
    case "QC_FAIL":
    case "CANCEL":
      // The internal narrative: never a notice.
      break;
  }

  if (enteredReady) out.push("READY");
  return out;
}
