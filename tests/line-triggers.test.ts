import { describe, expect, it } from "vitest";
import type { JobFlowAction } from "@/lib/case-flow";
import type { JobStatus, WaitingReason, RepairCaseStatus } from "@/lib/generated/prisma/enums";
import {
  JOB_COMPLETED_COALESCE_MS,
  noticesFor,
  type CaseSnapshot,
  type SendHistory,
  type TriggerAct,
  type TriggerJob,
} from "@/lib/line-triggers";

/**
 * M7.10 step 4 — the heart of the milestone. noticesFor is pure: given the
 * case before and after an act, the act, and what has already been sent,
 * it returns the Progress notices (and the Ready Milestone) to send. One
 * test per rule in CONTEXT.md, one per never-list item, and the guards.
 */

const NOW = new Date("2026-09-10T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function job(id: string, status: JobStatus, waitingReason: WaitingReason | null = null): TriggerJob {
  return { id, status, waitingReason };
}

function snap(jobs: TriggerJob[], caseStatus: RepairCaseStatus = "CHECKED_IN"): CaseSnapshot {
  return { caseStatus, jobs };
}

const nothingSent: SendHistory = { kinds: [], lastKind: null, lastJobCompletedAt: null };
const started: SendHistory = {
  kinds: ["CHECKIN", "QUOTATION", "WORK_STARTED"],
  lastKind: "WORK_STARTED",
  lastJobCompletedAt: null,
};

const flow = (action: JobFlowAction, jobId = "a"): TriggerAct => ({
  kind: "JOB_FLOW",
  action,
  jobId,
});
const revert = (jobId = "a"): TriggerAct => ({ kind: "REVERT", jobId });
const markReady: TriggerAct = { kind: "MARK_READY" };

function notices(
  before: CaseSnapshot,
  after: CaseSnapshot,
  act: TriggerAct,
  history: SendHistory = nothingSent,
  now: Date = NOW,
) {
  return noticesFor({ before, after, act, history, now });
}

/* ------------------------------------------------------------------ */
/* WORK_STARTED — once per case, on the first Job reaching In progress */
/* ------------------------------------------------------------------ */

describe("WORK_STARTED", () => {
  it("fires on the first Job reaching IN_PROGRESS", () => {
    expect(
      notices(snap([job("a", "AUTHORIZED")]), snap([job("a", "IN_PROGRESS")]), flow("START_WORK")),
    ).toEqual(["WORK_STARTED"]);
  });

  it("fires only once: a second Job starting while the first is in progress sends nothing", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("b", "AUTHORIZED")]),
        snap([job("a", "IN_PROGRESS"), job("b", "IN_PROGRESS")]),
        flow("START_WORK", "b"),
        started,
      ),
    ).toEqual([]);
  });

  it("does not fire again once any Job has been worked, even after that Job is done", () => {
    expect(
      notices(
        snap([job("a", "COMPLETED"), job("b", "AUTHORIZED")]),
        snap([job("a", "COMPLETED"), job("b", "IN_PROGRESS")]),
        flow("START_WORK", "b"),
        started,
      ),
    ).toEqual([]);
  });

  it("does not fire again after a revert brought the case back to unstarted — the history remembers", () => {
    expect(
      notices(snap([job("a", "AUTHORIZED")]), snap([job("a", "IN_PROGRESS")]), flow("START_WORK"), started),
    ).toEqual([]);
  });

  it("counts a recorded-but-not-sent WORK_STARTED as sent (the row exists; the dialog is the retry)", () => {
    expect(
      notices(snap([job("a", "AUTHORIZED")]), snap([job("a", "IN_PROGRESS")]), flow("START_WORK"), { kinds: ["WORK_STARTED"], lastKind: "WORK_STARTED",
        lastJobCompletedAt: null,
      }),
    ).toEqual([]);
  });

  it("fires even when an undecided Proposed line sits beside the work (the customer hears about the work, not the desk's attention)", () => {
    expect(
      notices(
        snap([job("a", "AUTHORIZED"), job("p", "PROPOSED")]),
        snap([job("a", "IN_PROGRESS"), job("p", "PROPOSED")]),
        flow("START_WORK"),
      ),
    ).toEqual(["WORK_STARTED"]);
  });
});

/* ------------------------------------------------------------------ */
/* WAITING_PARTS — Stage enters Waiting with reason Parts              */
/* ------------------------------------------------------------------ */

describe("WAITING_PARTS", () => {
  it("fires when work in progress stops for parts", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS")]),
        snap([job("a", "WAITING", "PARTS")]),
        flow("SET_WAITING"),
        started,
      ),
    ).toEqual(["WAITING_PARTS"]);
  });

  it("fires before work has started, when an authorized Job waits for parts", () => {
    expect(
      notices(snap([job("a", "AUTHORIZED")]), snap([job("a", "WAITING", "PARTS")]), flow("SET_WAITING")),
    ).toEqual(["WAITING_PARTS"]);
  });

  it.each(["PAINT_BOOTH", "TECHNICIAN", "OTHER"] as const)("never for a %s wait", (reason) => {
    expect(
      notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "WAITING", reason)]), flow("SET_WAITING"), started),
    ).toEqual([]);
  });

  it("does not fire when the Stage was already Waiting (a second Job joining a wait)", () => {
    expect(
      notices(
        snap([job("a", "WAITING", "PARTS"), job("b", "IN_PROGRESS")]),
        snap([job("a", "WAITING", "PARTS"), job("b", "WAITING", "PARTS")]),
        flow("SET_WAITING", "b"),
        { kinds: ["WORK_STARTED", "WAITING_PARTS"], lastKind: "WAITING_PARTS", lastJobCompletedAt: null },
      ),
    ).toEqual([]);
  });

  it("fires again for a later, separate Parts wait (the customer was told work resumed)", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS")]),
        snap([job("a", "WAITING", "PARTS")]),
        flow("SET_WAITING"),
        { kinds: ["WORK_STARTED", "WAITING_PARTS", "PARTS_ARRIVED"], lastKind: "PARTS_ARRIVED", lastJobCompletedAt: null },
      ),
    ).toEqual(["WAITING_PARTS"]);
  });
});

/* ------------------------------------------------------------------ */
/* PARTS_ARRIVED — a Parts wait ends by resuming                       */
/* ------------------------------------------------------------------ */

describe("PARTS_ARRIVED", () => {
  it("fires when a Parts wait ends by resuming", () => {
    expect(
      notices(
        snap([job("a", "WAITING", "PARTS")]),
        snap([job("a", "IN_PROGRESS")]),
        flow("START_WORK"),
        { kinds: ["WORK_STARTED", "WAITING_PARTS"], lastKind: "WAITING_PARTS", lastJobCompletedAt: null },
      ),
    ).toEqual(["PARTS_ARRIVED"]);
  });

  it("fires for the resuming Job even while another Job still waits", () => {
    expect(
      notices(
        snap([job("a", "WAITING", "PARTS"), job("b", "WAITING", "TECHNICIAN")]),
        snap([job("a", "IN_PROGRESS"), job("b", "WAITING", "TECHNICIAN")]),
        flow("START_WORK"),
        started,
      ),
    ).toEqual(["PARTS_ARRIVED"]);
  });

  it.each(["PAINT_BOOTH", "TECHNICIAN", "OTHER"] as const)("never when a %s wait ends", (reason) => {
    expect(
      notices(snap([job("a", "WAITING", reason)]), snap([job("a", "IN_PROGRESS")]), flow("START_WORK"), started),
    ).toEqual([]);
  });

  it("subsumes WORK_STARTED when the very first start is the end of a Parts wait — one message, the one that closes the loop", () => {
    expect(
      notices(snap([job("a", "WAITING", "PARTS")]), snap([job("a", "IN_PROGRESS")]), flow("START_WORK"), { kinds: ["WAITING_PARTS"], lastKind: "WAITING_PARTS",
        lastJobCompletedAt: null,
      }),
    ).toEqual(["PARTS_ARRIVED"]);
  });

  it("…and WORK_STARTED does not fire later for the next Job either", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("b", "AUTHORIZED")]),
        snap([job("a", "IN_PROGRESS"), job("b", "IN_PROGRESS")]),
        flow("START_WORK", "b"),
        { kinds: ["WAITING_PARTS", "PARTS_ARRIVED"], lastKind: "PARTS_ARRIVED", lastJobCompletedAt: null },
      ),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* IN_QC — Stage entry to In QC                                        */
/* ------------------------------------------------------------------ */

describe("IN_QC", () => {
  it("fires when the only Job goes to QC", () => {
    expect(
      notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "QC")]), flow("SEND_TO_QC"), started),
    ).toEqual(["IN_QC"]);
  });

  it("fires when the LAST working Job joins the others in QC", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("b", "QC")]),
        snap([job("a", "QC"), job("b", "QC")]),
        flow("SEND_TO_QC"),
        started,
      ),
    ).toEqual(["IN_QC"]);
  });

  it("does not fire while another Job is still in progress", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("b", "IN_PROGRESS")]),
        snap([job("a", "QC"), job("b", "IN_PROGRESS")]),
        flow("SEND_TO_QC"),
        started,
      ),
    ).toEqual([]);
  });

  it("does not fire while another Job is still waiting", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("b", "WAITING", "TECHNICIAN")]),
        snap([job("a", "QC"), job("b", "WAITING", "TECHNICIAN")]),
        flow("SEND_TO_QC"),
        started,
      ),
    ).toEqual([]);
  });

  it("does not fire while another Job is authorized but not started (work remains)", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("b", "AUTHORIZED")]),
        snap([job("a", "QC"), job("b", "AUTHORIZED")]),
        flow("SEND_TO_QC"),
        started,
      ),
    ).toEqual([]);
  });

  it("fires beside a completed Job (done work is not active work)", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("b", "COMPLETED")]),
        snap([job("a", "QC"), job("b", "COMPLETED")]),
        flow("SEND_TO_QC"),
        started,
      ),
    ).toEqual(["IN_QC"]);
  });

  it("fires even with an undecided Proposed line beside the work", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("p", "PROPOSED")]),
        snap([job("a", "QC"), job("p", "PROPOSED")]),
        flow("SEND_TO_QC"),
        started,
      ),
    ).toEqual(["IN_QC"]);
  });

  it("does not repeat after a QC bounce when the last word was already 'final check' (the bounce stays silent)", () => {
    const history: SendHistory = { kinds: ["WORK_STARTED", "IN_QC"], lastKind: "IN_QC", lastJobCompletedAt: null };
    expect(
      notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "QC")]), flow("SEND_TO_QC"), history),
    ).toEqual([]);
  });

  it("fires again when the case re-enters final check after Ready was revoked (the last word was READY)", () => {
    const history: SendHistory = { kinds: ["WORK_STARTED", "IN_QC", "READY"], lastKind: "READY", lastJobCompletedAt: null };
    expect(
      notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "QC")]), flow("SEND_TO_QC"), history),
    ).toEqual(["IN_QC"]);
  });

  it("fires again when something else was told in between (a Job finished, then the rest reached final check)", () => {
    const history: SendHistory = {
      kinds: ["WORK_STARTED", "IN_QC", "JOB_COMPLETED"],
      lastKind: "JOB_COMPLETED",
      lastJobCompletedAt: minutesAgo(200),
    };
    expect(
      notices(
        snap([job("a", "COMPLETED"), job("b", "IN_PROGRESS")]),
        snap([job("a", "COMPLETED"), job("b", "QC")]),
        flow("SEND_TO_QC", "b"),
        history,
      ),
    ).toEqual(["IN_QC"]);
  });
});

/* ------------------------------------------------------------------ */
/* JOB_COMPLETED — each QC pass, two guards                            */
/* ------------------------------------------------------------------ */

describe("JOB_COMPLETED", () => {
  it("fires on a QC pass that leaves work open", () => {
    expect(
      notices(
        snap([job("a", "QC"), job("b", "IN_PROGRESS")]),
        snap([job("a", "COMPLETED"), job("b", "IN_PROGRESS")]),
        flow("QC_PASS"),
        started,
      ),
    ).toEqual(["JOB_COMPLETED"]);
  });

  it("is silent when the pass leaves the case in final check — Ready carries the finished work", () => {
    expect(
      notices(snap([job("a", "QC"), job("b", "QC")]), snap([job("a", "COMPLETED"), job("b", "QC")]), flow("QC_PASS"), {
        kinds: ["WORK_STARTED", "IN_QC"],
        lastKind: "IN_QC",
        lastJobCompletedAt: null,
      }),
    ).toEqual([]);
  });

  it("fires when the other work is authorized but not yet started", () => {
    expect(
      notices(
        snap([job("a", "QC"), job("b", "AUTHORIZED")]),
        snap([job("a", "COMPLETED"), job("b", "AUTHORIZED")]),
        flow("QC_PASS"),
        started,
      ),
    ).toEqual(["JOB_COMPLETED"]);
  });

  it("fires when the other work is still waiting", () => {
    expect(
      notices(
        snap([job("a", "QC"), job("b", "WAITING", "TECHNICIAN")]),
        snap([job("a", "COMPLETED"), job("b", "WAITING", "TECHNICIAN")]),
        flow("QC_PASS"),
        started,
      ),
    ).toEqual(["JOB_COMPLETED"]);
  });

  it("Ready subsumes it: the pass that makes the case Ready sends only READY", () => {
    expect(
      notices(snap([job("a", "QC")]), snap([job("a", "COMPLETED")], "READY"), flow("QC_PASS"), started),
    ).toEqual(["READY"]);
  });

  it("coalesces: a completion 59 minutes after the last notice is skipped", () => {
    expect(
      notices(
        snap([job("a", "QC"), job("b", "IN_PROGRESS")]),
        snap([job("a", "COMPLETED"), job("b", "IN_PROGRESS")]),
        flow("QC_PASS"),
        { kinds: ["WORK_STARTED", "JOB_COMPLETED"], lastKind: "JOB_COMPLETED", lastJobCompletedAt: minutesAgo(59) },
      ),
    ).toEqual([]);
  });

  it("coalesces: a completion 61 minutes after the last notice is sent", () => {
    expect(
      notices(
        snap([job("a", "QC"), job("b", "IN_PROGRESS")]),
        snap([job("a", "COMPLETED"), job("b", "IN_PROGRESS")]),
        flow("QC_PASS"),
        { kinds: ["WORK_STARTED", "JOB_COMPLETED"], lastKind: "JOB_COMPLETED", lastJobCompletedAt: minutesAgo(61) },
      ),
    ).toEqual(["JOB_COMPLETED"]);
  });

  it("the coalescing window is one hour", () => {
    expect(JOB_COMPLETED_COALESCE_MS).toBe(60 * 60 * 1000);
  });

  it("coalescing never holds back READY", () => {
    expect(
      notices(
        snap([job("a", "QC"), job("b", "COMPLETED")]),
        snap([job("a", "COMPLETED"), job("b", "COMPLETED")], "READY"),
        flow("QC_PASS"),
        { kinds: ["WORK_STARTED", "JOB_COMPLETED"], lastKind: "JOB_COMPLETED", lastJobCompletedAt: minutesAgo(5) },
      ),
    ).toEqual(["READY"]);
  });
});

/* ------------------------------------------------------------------ */
/* READY — case status entering READY from any act                     */
/* ------------------------------------------------------------------ */

describe("READY", () => {
  it("fires on Mark ready", () => {
    expect(notices(snap([job("a", "COMPLETED")]), snap([job("a", "COMPLETED")], "READY"), markReady, started)).toEqual([
      "READY",
    ]);
  });

  it("fires on Mark ready of a case whose work never took shape", () => {
    expect(notices(snap([]), snap([], "READY"), markReady)).toEqual(["READY"]);
  });

  it("does not fire when the case was already Ready", () => {
    expect(
      notices(snap([job("a", "COMPLETED")], "READY"), snap([job("a", "COMPLETED")], "READY"), markReady, { kinds: ["READY"], lastKind: "READY",
        lastJobCompletedAt: null,
      }),
    ).toEqual([]);
  });

  it("fires again when Ready is revoked and re-reached — the customer was told, work reopened, it is ready again", () => {
    expect(
      notices(snap([job("a", "QC")]), snap([job("a", "COMPLETED")], "READY"), flow("QC_PASS"), { kinds: ["WORK_STARTED", "READY"], lastKind: "READY",
        lastJobCompletedAt: null,
      }),
    ).toEqual(["READY"]);
  });

  it("fires when a cancellation of the last active Job makes the case Ready (the cancellation itself stays silent)", () => {
    expect(
      notices(
        snap([job("a", "COMPLETED"), job("b", "IN_PROGRESS")]),
        snap([job("a", "COMPLETED"), job("b", "CANCELLED")], "READY"),
        flow("CANCEL", "b"),
        started,
      ),
    ).toEqual(["READY"]);
  });
});

/* ------------------------------------------------------------------ */
/* Never — one test per item on ADR-007's closed list                  */
/* ------------------------------------------------------------------ */

describe("never a Progress notice", () => {
  it("a QC bounce", () => {
    expect(notices(snap([job("a", "QC")]), snap([job("a", "IN_PROGRESS")]), flow("QC_FAIL"), started)).toEqual([]);
  });

  it("a QC bounce, even though the case looks like work just started again", () => {
    expect(notices(snap([job("a", "QC")]), snap([job("a", "IN_PROGRESS")]), flow("QC_FAIL"), nothingSent)).toEqual([]);
  });

  it("a revert (backwards from QC)", () => {
    expect(notices(snap([job("a", "QC")]), snap([job("a", "IN_PROGRESS")]), revert(), started)).toEqual([]);
  });

  it("a revert that reopens a Ready case", () => {
    expect(
      notices(snap([job("a", "COMPLETED")], "READY"), snap([job("a", "QC")], "CHECKED_IN"), revert(), started),
    ).toEqual([]);
  });

  it("a revert that lands on a Parts wait", () => {
    expect(
      notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "WAITING", "PARTS")]), revert(), started),
    ).toEqual([]);
  });

  it("a revert that lands on In progress from unstarted", () => {
    expect(
      notices(snap([job("a", "WAITING", "PARTS")]), snap([job("a", "IN_PROGRESS")]), revert(), nothingSent),
    ).toEqual([]);
  });

  it("a cancellation", () => {
    expect(
      notices(
        snap([job("a", "IN_PROGRESS"), job("b", "IN_PROGRESS")]),
        snap([job("a", "CANCELLED"), job("b", "IN_PROGRESS")]),
        flow("CANCEL"),
        started,
      ),
    ).toEqual([]);
  });

  it("a Paint-booth wait", () => {
    expect(
      notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "WAITING", "PAINT_BOOTH")]), flow("SET_WAITING"), started),
    ).toEqual([]);
  });

  it("a Technician wait", () => {
    expect(
      notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "WAITING", "TECHNICIAN")]), flow("SET_WAITING"), started),
    ).toEqual([]);
  });

  it("a wait for any other reason", () => {
    expect(
      notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "WAITING", "OTHER")]), flow("SET_WAITING"), started),
    ).toEqual([]);
  });

  it("a waiting-reason change from Parts to Technician", () => {
    expect(
      notices(
        snap([job("a", "WAITING", "PARTS")]),
        snap([job("a", "WAITING", "TECHNICIAN")]),
        flow("SET_WAITING"),
        { kinds: ["WORK_STARTED", "WAITING_PARTS"], lastKind: "WAITING_PARTS", lastJobCompletedAt: null },
      ),
    ).toEqual([]);
  });

  it("a waiting-reason change from Technician to Parts", () => {
    expect(
      notices(snap([job("a", "WAITING", "TECHNICIAN")]), snap([job("a", "WAITING", "PARTS")]), flow("SET_WAITING"), started),
    ).toEqual([]);
  });

  it("a Job merely starting (the second one)", () => {
    expect(
      notices(
        snap([job("a", "QC"), job("b", "AUTHORIZED")]),
        snap([job("a", "QC"), job("b", "IN_PROGRESS")]),
        flow("START_WORK", "b"),
        started,
      ),
    ).toEqual([]);
  });

  it("anything on a Delivered case — the work record is frozen", () => {
    expect(
      notices(snap([job("a", "QC")], "DELIVERED"), snap([job("a", "COMPLETED")], "DELIVERED"), flow("QC_PASS"), started),
    ).toEqual([]);
  });

  it("an act that changed nothing", () => {
    expect(notices(snap([job("a", "IN_PROGRESS")]), snap([job("a", "IN_PROGRESS")]), flow("START_WORK"), started)).toEqual(
      [],
    );
  });
});

/* ------------------------------------------------------------------ */
/* The full walk of the brief's step 5, act by act                     */
/* ------------------------------------------------------------------ */

describe("the two-Job walk", () => {
  it("yields exactly WORK_STARTED, WAITING_PARTS, PARTS_ARRIVED, IN_QC, READY", () => {
    const sent: SendHistory["kinds"][number][] = ["CHECKIN", "QUOTATION"];
    let last: Date | null = null;
    const history = (): SendHistory => ({ kinds: [...sent], lastKind: sent.at(-1) ?? null, lastJobCompletedAt: last });
    const record = (kinds: string[]) => {
      for (const kind of kinds) {
        sent.push(kind as SendHistory["kinds"][number]);
        if (kind === "JOB_COMPLETED") last = NOW;
      }
      return kinds;
    };
    const A = (s: JobStatus, r: WaitingReason | null = null) => job("a", s, r);
    const B = (s: JobStatus, r: WaitingReason | null = null) => job("b", s, r);
    const walk: string[] = [];

    walk.push(...record(notices(snap([A("AUTHORIZED"), B("AUTHORIZED")]), snap([A("IN_PROGRESS"), B("AUTHORIZED")]), flow("START_WORK"), history())));
    walk.push(...record(notices(snap([A("IN_PROGRESS"), B("AUTHORIZED")]), snap([A("IN_PROGRESS"), B("IN_PROGRESS")]), flow("START_WORK", "b"), history())));
    walk.push(...record(notices(snap([A("IN_PROGRESS"), B("IN_PROGRESS")]), snap([A("WAITING", "PARTS"), B("IN_PROGRESS")]), flow("SET_WAITING"), history())));
    walk.push(...record(notices(snap([A("WAITING", "PARTS"), B("IN_PROGRESS")]), snap([A("IN_PROGRESS"), B("IN_PROGRESS")]), flow("START_WORK"), history())));
    walk.push(...record(notices(snap([A("IN_PROGRESS"), B("IN_PROGRESS")]), snap([A("QC"), B("IN_PROGRESS")]), flow("SEND_TO_QC"), history())));
    walk.push(...record(notices(snap([A("QC"), B("IN_PROGRESS")]), snap([A("QC"), B("QC")]), flow("SEND_TO_QC", "b"), history())));
    walk.push(...record(notices(snap([A("QC"), B("QC")]), snap([A("IN_PROGRESS"), B("QC")]), flow("QC_FAIL"), history())));
    walk.push(...record(notices(snap([A("IN_PROGRESS"), B("QC")]), snap([A("QC"), B("QC")]), flow("SEND_TO_QC"), history())));
    walk.push(...record(notices(snap([A("QC"), B("QC")]), snap([A("COMPLETED"), B("QC")]), flow("QC_PASS"), history())));
    walk.push(...record(notices(snap([A("COMPLETED"), B("QC")]), snap([A("COMPLETED"), B("COMPLETED")], "READY"), flow("QC_PASS", "b"), history())));

    // The bounce and its re-entry are silent; the first pass leaves the case
    // in final check (silent — Ready carries the work); the last pass is READY.
    expect(walk).toEqual(["WORK_STARTED", "WAITING_PARTS", "PARTS_ARRIVED", "IN_QC", "READY"]);
  });

  it("tells about a Job finished while the other is still being worked, then final check, then ready", () => {
    const A = (s: JobStatus) => job("a", s);
    const B = (s: JobStatus) => job("b", s);
    const h = (kinds: SendHistory["kinds"], last: Date | null = null): SendHistory => ({
      kinds,
      lastKind: kinds.at(-1) ?? null,
      lastJobCompletedAt: last,
    });
    expect(notices(snap([A("QC"), B("IN_PROGRESS")]), snap([A("COMPLETED"), B("IN_PROGRESS")]), flow("QC_PASS"), h(["WORK_STARTED"]))).toEqual(["JOB_COMPLETED"]);
    expect(notices(snap([A("COMPLETED"), B("IN_PROGRESS")]), snap([A("COMPLETED"), B("QC")]), flow("SEND_TO_QC", "b"), h(["WORK_STARTED", "JOB_COMPLETED"], NOW))).toEqual(["IN_QC"]);
    expect(notices(snap([A("COMPLETED"), B("QC")]), snap([A("COMPLETED"), B("COMPLETED")], "READY"), flow("QC_PASS", "b"), h(["WORK_STARTED", "JOB_COMPLETED", "IN_QC"], NOW))).toEqual(["READY"]);
  });
});
