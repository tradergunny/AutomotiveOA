import { describe, expect, it } from "vitest";
import { canConfirm, findingSeverity } from "@/lib/inspection";

/**
 * The accept step's rule (M3 + the confirmation gate): a Finding is only
 * acceptable once it says what the shop intends to do about it, and — for a
 * map Finding — what is wrong in the first place. Accepting is what makes a
 * Finding groupable into a Job, so neither half may be blank: an empty proposal
 * registers work nobody described, and a proposal with no damage behind it
 * prices a panel for no stated reason. Findings are created with both lists
 * empty, so this gate is the only thing standing between a bare tap on the map
 * and a line on a quotation.
 */
describe("canConfirm: the accept gate", () => {
  const map = { source: "DAMAGE_MAP" } as const;
  const checklist = { source: "CHECKLIST" as const, damageTypes: [] };

  it("refuses a finding with nothing proposed", () => {
    expect(canConfirm({ ...map, damageTypes: ["SCRATCH"], proposedActions: [] })).toBe(false);
  });

  it("refuses a map finding that never said what is wrong", () => {
    expect(canConfirm({ ...map, damageTypes: [], proposedActions: ["REPAIR"] })).toBe(false);
  });

  it("refuses a freshly created finding, which starts blank on both counts", () => {
    expect(canConfirm({ ...map, damageTypes: [], proposedActions: [] })).toBe(false);
  });

  it("accepts once the damage and the fix are both named", () => {
    expect(canConfirm({ ...map, damageTypes: ["SCRATCH"], proposedActions: ["REPAIR"] })).toBe(true);
    expect(
      canConfirm({ ...map, damageTypes: ["DENT", "CRACK"], proposedActions: ["REPLACE", "REPAINT"] }),
    ).toBe(true);
  });

  it("holds for wear items too — a checklist finding still names its service", () => {
    expect(canConfirm({ ...checklist, proposedActions: [] })).toBe(false);
    expect(canConfirm({ ...checklist, proposedActions: ["SERVICE"] })).toBe(true);
  });

  it("never asks a checklist finding for damage types — it carries a condition", () => {
    expect(canConfirm({ ...checklist, proposedActions: ["SERVICE"] })).toBe(true);
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
