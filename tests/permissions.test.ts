import { describe, expect, it } from "vitest";
import { can, PERMISSIONS } from "@/lib/permissions";

describe("manager-only permission stubs", () => {
  it("manager can override catalog prices and sign off QC", () => {
    expect(can("MANAGER", "catalog.priceOverride")).toBe(true);
    expect(can("MANAGER", "qc.signOff")).toBe(true);
  });

  it("advisor can do neither", () => {
    expect(can("ADVISOR", "catalog.priceOverride")).toBe(false);
    expect(can("ADVISOR", "qc.signOff")).toBe(false);
  });

  it("every permission names at least one role", () => {
    for (const roles of Object.values(PERMISSIONS)) {
      expect(roles.length).toBeGreaterThan(0);
    }
  });
});
