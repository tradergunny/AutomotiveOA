import { describe, expect, it } from "vitest";
import { can, PERMISSIONS } from "@/lib/permissions";

describe("manager-only permissions", () => {
  it("manager holds every special capability", () => {
    expect(can("MANAGER", "catalog.manage")).toBe(true);
    expect(can("MANAGER", "catalog.priceOverride")).toBe(true);
    expect(can("MANAGER", "authorization.revert")).toBe(true);
    expect(can("MANAGER", "qc.signOff")).toBe(true);
  });

  it("advisor holds none of them", () => {
    expect(can("ADVISOR", "catalog.manage")).toBe(false);
    expect(can("ADVISOR", "catalog.priceOverride")).toBe(false);
    expect(can("ADVISOR", "authorization.revert")).toBe(false);
    expect(can("ADVISOR", "qc.signOff")).toBe(false);
  });

  it("every permission names at least one role", () => {
    for (const roles of Object.values(PERMISSIONS)) {
      expect(roles.length).toBeGreaterThan(0);
    }
  });
});
