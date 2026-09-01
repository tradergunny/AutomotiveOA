import { describe, expect, it } from "vitest";
import { canConfirm, findingSeverity, isGroupable } from "@/lib/inspection";

/**
 * The accept step's rule (M3 + the confirmation gate). A map Finding must say
 * what is wrong AND what to do about it: accepting means "this is work we
 * intend to register", so an empty proposal registers work nobody described,
 * and a proposal with no damage behind it prices a panel for no stated reason.
 * Findings are created blank, so this gate is the only thing between a bare tap
 * on the map and a line on a quotation.
 *
 * A checklist Finding is different, and getting that wrong stranded whole
 * cases: its tri-state settled the question before the Finding existed, and
 * "due soon" means precisely that no work is proposed now. Demanding an action
 * anyway left the item permanently unacceptable, which pinned its case at
 * "Open inspection" for good.
 */
describe("canConfirm: the accept gate", () => {
  const map = { source: "DAMAGE_MAP" as const, condition: null };

  it("refuses a map finding with nothing proposed", () => {
    expect(canConfirm({ ...map, damageTypes: ["SCRATCH"], proposedActions: [] })).toBe(false);
  });

  it("refuses a map finding that never said what is wrong", () => {
    expect(canConfirm({ ...map, damageTypes: [], proposedActions: ["REPAIR"] })).toBe(false);
  });

  it("refuses a freshly created finding, which starts blank on both counts", () => {
    expect(canConfirm({ ...map, damageTypes: [], proposedActions: [] })).toBe(false);
  });

  it("accepts a map finding once the damage and the fix are both named", () => {
    expect(canConfirm({ ...map, damageTypes: ["SCRATCH"], proposedActions: ["REPAIR"] })).toBe(true);
    expect(
      canConfirm({ ...map, damageTypes: ["DENT", "CRACK"], proposedActions: ["REPLACE", "REPAINT"] }),
    ).toBe(true);
  });

  it("accepts a due-soon wear item that proposes no work at all", () => {
    expect(
      canConfirm({
        source: "CHECKLIST",
        condition: "DUE_SOON",
        damageTypes: [],
        proposedActions: [],
      }),
    ).toBe(true);
  });

  it("still asks a needs-work item what work", () => {
    const needsWork = { source: "CHECKLIST" as const, condition: "NEEDS_WORK" as const, damageTypes: [] };
    expect(canConfirm({ ...needsWork, proposedActions: [] })).toBe(false);
    expect(canConfirm({ ...needsWork, proposedActions: ["SERVICE"] })).toBe(true);
  });

  it("never asks a checklist finding for damage types — it carries a condition", () => {
    expect(
      canConfirm({
        source: "CHECKLIST",
        condition: "NEEDS_WORK",
        damageTypes: [],
        proposedActions: ["SERVICE"],
      }),
    ).toBe(true);
  });

  it("refuses a checklist finding whose condition was never set", () => {
    expect(
      canConfirm({ source: "CHECKLIST", condition: null, damageTypes: [], proposedActions: [] }),
    ).toBe(false);
  });
});

/**
 * The other half of the same wedge. The only way out of the ungrouped set is
 * acquiring a Job, so an accepted Finding proposing no work would have stranded
 * its case at "Group into Jobs" — forcing the advisor to raise a Job for work
 * they had just recorded as unnecessary.
 */
describe("isGroupable: what the grouping step is offered", () => {
  const accepted = { jobId: null, confirmedAt: "2026-09-02T00:00:00.000Z" };

  it("offers an accepted, ungrouped finding that proposes work", () => {
    expect(isGroupable({ ...accepted, proposedActions: ["REPAIR"] })).toBe(true);
  });

  it("withholds a due-soon item, which is complete with nothing to price", () => {
    expect(isGroupable({ ...accepted, proposedActions: [] })).toBe(false);
  });

  it("withholds a finding still being keyed in", () => {
    expect(isGroupable({ jobId: null, confirmedAt: null, proposedActions: ["REPAIR"] })).toBe(false);
  });

  it("withholds one already on a Job", () => {
    expect(isGroupable({ ...accepted, jobId: "job1", proposedActions: ["REPAIR"] })).toBe(false);
  });

  it("takes a Date as readily as an ISO string — Prisma rows are callers too", () => {
    expect(
      isGroupable({ jobId: null, confirmedAt: new Date(), proposedActions: ["REPAIR"] }),
    ).toBe(true);
  });
});

/** The findings list paints its left edge from this (DESIGN.md D-3). */
describe("findingSeverity: what the row's severity edge reads", () => {
  it("reads damage types when there is no condition", () => {
    expect(findingSeverity({ damageTypes: ["SCRATCH"], condition: null })).toBe("MINOR");
    expect(findingSeverity({ damageTypes: ["DENT"], condition: null })).toBe("MINOR");
    expect(findingSeverity({ damageTypes: ["SCRATCH", "CRACK"], condition: null })).toBe("SEVERE");
    expect(findingSeverity({ damageTypes: ["BROKEN"], condition: null })).toBe("SEVERE");
  });

  it("lets a checklist condition win over damage types", () => {
    expect(findingSeverity({ damageTypes: [], condition: "DUE_SOON" })).toBe("MINOR");
    expect(findingSeverity({ damageTypes: [], condition: "NEEDS_WORK" })).toBe("SEVERE");
  });
});
