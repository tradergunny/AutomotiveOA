import { describe, expect, it } from "vitest";
import {
  boardGroupFor,
  canFlow,
  hasActiveWork,
  isAutoReadyEligible,
  JOB_FLOW_ACTIONS,
  jobRollup,
  nextActionFor,
  spineStepFor,
  stageFor,
  waitingBlockerFor,
  type JobFlowAction,
  type NextActionFacts,
  type Stage,
} from "@/lib/case-flow";
import { hasUnquotedProposed } from "@/lib/jobs";
import type { JobStatus, WaitingReason } from "@/lib/generated/prisma/enums";

const j = (status: JobStatus, waitingReason: WaitingReason | null = null) => ({
  status,
  waitingReason,
});

describe("the transition edge map (ruling 2)", () => {
  const allowed: [JobFlowAction, JobStatus][] = [
    ["START_WORK", "AUTHORIZED"],
    ["START_WORK", "WAITING"],
    ["SET_WAITING", "AUTHORIZED"],
    ["SET_WAITING", "IN_PROGRESS"],
    ["SET_WAITING", "WAITING"], // reason change
    ["SEND_TO_QC", "IN_PROGRESS"],
    ["QC_PASS", "QC"],
    ["QC_FAIL", "QC"],
    ["CANCEL", "AUTHORIZED"],
    ["CANCEL", "WAITING"],
    ["CANCEL", "IN_PROGRESS"],
  ];
  it("allows exactly the ruled edges", () => {
    const statuses: JobStatus[] = [
      "PROPOSED",
      "AUTHORIZED",
      "WAITING",
      "IN_PROGRESS",
      "QC",
      "COMPLETED",
      "DECLINED",
      "CANCELLED",
    ];
    for (const action of Object.keys(JOB_FLOW_ACTIONS) as JobFlowAction[]) {
      for (const from of statuses) {
        const expected = allowed.some(([a, f]) => a === action && f === from);
        expect(canFlow(action, from), `${action} from ${from}`).toBe(expected);
      }
    }
  });
  it("QC is mandatory — no edge completes work from IN_PROGRESS", () => {
    // The only edge landing on COMPLETED starts at QC.
    for (const [action, spec] of Object.entries(JOB_FLOW_ACTIONS)) {
      if (spec.to === "COMPLETED") {
        expect(spec.from, action).toEqual(["QC"]);
      }
    }
  });
});

describe("derived READY eligibility (ruling 4a)", () => {
  it("needs at least one completed, authorization-bearing job and no active work", () => {
    expect(isAutoReadyEligible([])).toBe(false); // no jobs → Mark ready territory
    expect(isAutoReadyEligible([j("DECLINED")])).toBe(false); // all declined too
    expect(isAutoReadyEligible([j("PROPOSED")])).toBe(false);
    expect(isAutoReadyEligible([j("COMPLETED")])).toBe(true);
    expect(isAutoReadyEligible([j("COMPLETED"), j("CANCELLED")])).toBe(true);
    expect(isAutoReadyEligible([j("COMPLETED"), j("DECLINED")])).toBe(true);
    // An undecided quote does not hold the car — the board surfaces it.
    expect(isAutoReadyEligible([j("COMPLETED"), j("PROPOSED")])).toBe(true);
    expect(isAutoReadyEligible([j("COMPLETED"), j("IN_PROGRESS")])).toBe(false);
    expect(isAutoReadyEligible([j("COMPLETED"), j("AUTHORIZED")])).toBe(false);
  });
  it("active work is exactly AUTHORIZED / WAITING / IN_PROGRESS / QC", () => {
    expect(hasActiveWork([j("AUTHORIZED")])).toBe(true);
    expect(hasActiveWork([j("WAITING")])).toBe(true);
    expect(hasActiveWork([j("IN_PROGRESS")])).toBe(true);
    expect(hasActiveWork([j("QC")])).toBe(true);
    expect(hasActiveWork([j("PROPOSED"), j("DECLINED"), j("COMPLETED"), j("CANCELLED")])).toBe(
      false,
    );
  });
});

describe("board placement (ruling 4c): one group, D-2 precedence", () => {
  it("attention first: an undecided proposal outranks everything", () => {
    expect(boardGroupFor("CHECKED_IN", [j("PROPOSED"), j("IN_PROGRESS")])).toBe("AWAITING_AUTH");
    expect(boardGroupFor("READY", [j("PROPOSED")])).toBe("AWAITING_AUTH");
  });
  it("then Waiting, In progress, In QC", () => {
    expect(boardGroupFor("CHECKED_IN", [j("WAITING"), j("IN_PROGRESS"), j("QC")])).toBe("WAITING");
    expect(boardGroupFor("CHECKED_IN", [j("IN_PROGRESS"), j("QC")])).toBe("IN_PROGRESS");
    expect(boardGroupFor("CHECKED_IN", [j("QC"), j("COMPLETED")])).toBe("IN_QC");
  });
  it("READY case with no attention lands in Ready for pickup", () => {
    expect(boardGroupFor("READY", [j("COMPLETED"), j("DECLINED")])).toBe("READY");
  });
  it("the leading catch-all takes everything else — no open case is invisible", () => {
    expect(boardGroupFor("CHECKED_IN", [])).toBe("IN_ASSESSMENT");
    expect(boardGroupFor("CHECKED_IN", [j("DECLINED"), j("CANCELLED")])).toBe("IN_ASSESSMENT");
  });
});

describe("stageFor (M7.5 brief §1): board groups + two Delivered flavors", () => {
  it("attention-first precedence matches the board exactly", () => {
    expect(stageFor("CHECKED_IN", [j("PROPOSED"), j("IN_PROGRESS")], 0)).toBe("AWAITING_AUTH");
    expect(stageFor("CHECKED_IN", [j("WAITING"), j("IN_PROGRESS"), j("QC")], 0)).toBe("WAITING");
    expect(stageFor("CHECKED_IN", [j("IN_PROGRESS"), j("QC")], 0)).toBe("IN_PROGRESS");
    expect(stageFor("CHECKED_IN", [j("QC"), j("COMPLETED")], 0)).toBe("IN_QC");
    expect(stageFor("READY", [j("COMPLETED"), j("DECLINED")], 0)).toBe("READY");
    expect(stageFor("READY", [j("PROPOSED")], 0)).toBe("AWAITING_AUTH");
    expect(stageFor("CHECKED_IN", [], 0)).toBe("IN_ASSESSMENT");
    expect(stageFor("CHECKED_IN", [j("DECLINED"), j("CANCELLED")], 0)).toBe("IN_ASSESSMENT");
  });
  it("boardGroupFor is a view of the same derivation — they can never disagree", () => {
    const cases: [Parameters<typeof boardGroupFor>[0], JobStatus[]][] = [
      ["CHECKED_IN", []],
      ["CHECKED_IN", ["PROPOSED", "IN_PROGRESS"]],
      ["CHECKED_IN", ["WAITING", "QC"]],
      ["CHECKED_IN", ["IN_PROGRESS"]],
      ["CHECKED_IN", ["QC"]],
      ["READY", ["COMPLETED"]],
      ["READY", ["PROPOSED"]],
      ["CHECKED_IN", ["DECLINED", "CANCELLED"]],
    ];
    for (const [status, statuses] of cases) {
      const jobs = statuses.map((s) => j(s));
      expect(stageFor(status, jobs, 0)).toBe(boardGroupFor(status, jobs));
    }
  });
  it("a delivered case reads Balance due while owed, Delivered once settled", () => {
    expect(stageFor("DELIVERED", [j("COMPLETED")], 250_000)).toBe("BALANCE_DUE");
    expect(stageFor("DELIVERED", [j("COMPLETED")], 0)).toBe("DELIVERED");
    // Overpaid never reads as owed.
    expect(stageFor("DELIVERED", [j("COMPLETED")], -50_000)).toBe("DELIVERED");
    // Delivered wins outright — frozen job statuses stop mattering.
    expect(stageFor("DELIVERED", [j("PROPOSED"), j("WAITING")], 0)).toBe("DELIVERED");
    expect(stageFor("DELIVERED", [j("PROPOSED")], 100)).toBe("BALANCE_DUE");
  });
  it("maps onto the five D-6 spine steps", () => {
    const expected: [Stage, string][] = [
      ["IN_ASSESSMENT", "ASSESSMENT"],
      ["AWAITING_AUTH", "AUTHORIZATION"],
      ["WAITING", "WORK"],
      ["IN_PROGRESS", "WORK"],
      ["IN_QC", "WORK"],
      ["READY", "READY"],
      ["BALANCE_DUE", "DELIVERED"],
      ["DELIVERED", "DELIVERED"],
    ];
    for (const [stage, step] of expected) expect(spineStepFor(stage)).toBe(step);
  });
});

describe("nextActionFor (D-6): one primary, at most one secondary", () => {
  const facts = (overrides: Partial<NextActionFacts> = {}): NextActionFacts => ({
    findingsCount: 0,
    unconfirmedFindingsCount: 0,
    ungroupedFindingsCount: 0,
    unpricedProposedCount: 0,
    hasUnquotedProposed: false,
    totalDueSatang: 0,
    ...overrides,
  });

  it("walks the assessment cascade", () => {
    expect(nextActionFor("IN_ASSESSMENT", facts())).toEqual({
      primary: "OPEN_INSPECTION",
      secondary: null,
    });
    // A finding the advisor has not accepted yet cannot be grouped, so the
    // cascade sends them back to the inspection rather than to an empty
    // grouping step.
    expect(
      nextActionFor(
        "IN_ASSESSMENT",
        facts({ findingsCount: 3, unconfirmedFindingsCount: 1, ungroupedFindingsCount: 2 }),
      ),
    ).toEqual({ primary: "OPEN_INSPECTION", secondary: null });
    expect(
      nextActionFor("IN_ASSESSMENT", facts({ findingsCount: 3, ungroupedFindingsCount: 3 })),
    ).toEqual({ primary: "GROUP_FINDINGS", secondary: null });
    // Everything grouped, nothing live (all declined/cancelled): no push.
    expect(nextActionFor("IN_ASSESSMENT", facts({ findingsCount: 3 }))).toEqual({
      primary: null,
      secondary: null,
    });
  });
  it("prices before authorization — the cascade's tail lives under Awaiting auth", () => {
    expect(
      nextActionFor("AWAITING_AUTH", facts({ findingsCount: 3, unpricedProposedCount: 2 })),
    ).toEqual({ primary: "SET_PRICES", secondary: null });
  });
  it("suggests the quotation as the professional path, never a gate", () => {
    expect(nextActionFor("AWAITING_AUTH", facts({ hasUnquotedProposed: true }))).toEqual({
      primary: "RECORD_AUTHORIZATION",
      secondary: "ISSUE_QUOTATION",
    });
    // Covered by a quotation — recording is all that is left.
    expect(nextActionFor("AWAITING_AUTH", facts())).toEqual({
      primary: "RECORD_AUTHORIZATION",
      secondary: null,
    });
  });
  it("waiting and in-progress push nothing — the header shows state, not a button", () => {
    expect(nextActionFor("WAITING", facts())).toEqual({ primary: null, secondary: null });
    expect(nextActionFor("IN_PROGRESS", facts())).toEqual({ primary: null, secondary: null });
  });
  it("QC, Ready, and the money tail", () => {
    expect(nextActionFor("IN_QC", facts())).toEqual({ primary: "RECORD_QC", secondary: null });
    expect(nextActionFor("READY", facts({ totalDueSatang: 1_250_000 }))).toEqual({
      primary: "RECORD_PAYMENT",
      secondary: "MARK_DELIVERED",
    });
    // Nothing left to collect: hand it over.
    expect(nextActionFor("READY", facts())).toEqual({
      primary: "MARK_DELIVERED",
      secondary: null,
    });
    expect(nextActionFor("BALANCE_DUE", facts({ totalDueSatang: 500 }))).toEqual({
      primary: "RECORD_PAYMENT",
      secondary: null,
    });
    expect(nextActionFor("DELIVERED", facts())).toEqual({ primary: null, secondary: null });
  });
});

describe("waitingBlockerFor (D-6): the header renders the blocker itself", () => {
  const line = (orderStatus: "NOT_ORDERED" | "ORDERED" | "ARRIVED", eta: string | null) => ({
    orderStatus,
    etaDate: eta ? new Date(`${eta}T00:00:00Z`) : null,
  });
  it("counts pending parts across Waiting(Parts) jobs and finds the nearest ETA", () => {
    const blocker = waitingBlockerFor([
      {
        status: "WAITING",
        waitingReason: "PARTS",
        partLines: [line("ORDERED", "2026-08-30"), line("ARRIVED", "2026-08-25")],
      },
      {
        status: "WAITING",
        waitingReason: "PARTS",
        partLines: [line("NOT_ORDERED", "2026-09-02"), line("NOT_ORDERED", null)],
      },
      { status: "IN_PROGRESS", waitingReason: null, partLines: [line("ORDERED", "2026-08-01")] },
    ]);
    expect(blocker.reasons).toEqual(["PARTS"]);
    expect(blocker.pendingParts).toBe(3);
    expect(blocker.nextEta?.toISOString().slice(0, 10)).toBe("2026-08-30");
  });
  it("lists distinct reasons in the fixed order, parts summary only for Parts", () => {
    const blocker = waitingBlockerFor([
      { status: "WAITING", waitingReason: "TECHNICIAN", partLines: [] },
      { status: "WAITING", waitingReason: "PAINT_BOOTH", partLines: [] },
      { status: "WAITING", waitingReason: "PAINT_BOOTH", partLines: [] },
    ]);
    expect(blocker.reasons).toEqual(["PAINT_BOOTH", "TECHNICIAN"]);
    expect(blocker.pendingParts).toBe(0);
    expect(blocker.nextEta).toBeNull();
  });
});

describe("hasUnquotedProposed (D-6's Issue-quotation trigger)", () => {
  const quote = (lines: { jobId: string | null; priceSatang: number }[]) => ({ lines });
  it("true while a priced proposed job is uncovered, at its current price", () => {
    const jobs = [{ id: "a", status: "PROPOSED" as const, priceSatang: 100_000 }];
    expect(hasUnquotedProposed(jobs, [])).toBe(true);
    // Covered at a stale price still counts as uncovered.
    expect(hasUnquotedProposed(jobs, [quote([{ jobId: "a", priceSatang: 90_000 }])])).toBe(true);
    expect(hasUnquotedProposed(jobs, [quote([{ jobId: "a", priceSatang: 100_000 }])])).toBe(false);
  });
  it("unpriced, non-proposed, and quoted jobs never trigger it", () => {
    expect(hasUnquotedProposed([{ id: "a", status: "PROPOSED", priceSatang: null }], [])).toBe(
      false,
    );
    expect(hasUnquotedProposed([{ id: "a", status: "AUTHORIZED", priceSatang: 100 }], [])).toBe(
      false,
    );
  });
});

describe("the status rollup", () => {
  it("counts in lifecycle order and splits Waiting per reason", () => {
    const entries = jobRollup([
      j("IN_PROGRESS"),
      j("WAITING", "PARTS"),
      j("IN_PROGRESS"),
      j("WAITING", "PAINT_BOOTH"),
      j("WAITING", "PARTS"),
      j("DECLINED"),
    ]);
    expect(entries).toEqual([
      { status: "WAITING", waitingReason: "PARTS", count: 2 },
      { status: "WAITING", waitingReason: "PAINT_BOOTH", count: 1 },
      { status: "IN_PROGRESS", waitingReason: null, count: 2 },
      { status: "DECLINED", waitingReason: null, count: 1 },
    ]);
  });
  it("is empty for no jobs", () => {
    expect(jobRollup([])).toEqual([]);
  });
});
