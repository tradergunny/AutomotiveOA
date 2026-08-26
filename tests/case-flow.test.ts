import { describe, expect, it } from "vitest";
import {
  boardGroupFor,
  canFlow,
  hasActiveWork,
  isAutoReadyEligible,
  JOB_FLOW_ACTIONS,
  jobRollup,
  type JobFlowAction,
} from "@/lib/case-flow";
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
