import { describe, expect, it } from "vitest";
import {
  followUpCandidates,
  type FollowUpCandidateFinding,
  type FollowUpCandidateJob,
} from "@/lib/followups";

/**
 * The M7 mint rule (decision 4), pinned: one row per DECLINED Job; one per
 * wear Finding that never became authorized work; a Finding on a declined
 * Job is covered by that Job's row; CANCELLED is deliberately excluded.
 */

const job = (
  id: string,
  status: FollowUpCandidateJob["status"],
  priceSatang: number | null = 1_800_000,
): FollowUpCandidateJob => ({ id, status, title: `job ${id}`, priceSatang });

const wear = (
  id: string,
  jobStatus: FollowUpCandidateFinding["jobStatus"],
  condition: FollowUpCandidateFinding["condition"] = "NEEDS_WORK",
): FollowUpCandidateFinding => ({
  id,
  source: "CHECKLIST",
  checklistItem: "brakes",
  condition,
  jobStatus,
});

describe("followUpCandidates", () => {
  it("mints one row per declined job, snapshotting title and quoted price", () => {
    const candidates = followUpCandidates(
      [job("j1", "DECLINED"), job("j2", "COMPLETED")],
      [],
    );
    expect(candidates).toEqual([
      { jobId: "j1", jobTitle: "job j1", quotedPriceSatang: 1_800_000 },
    ]);
  });

  it("a declined job may be unpriced — the row still mints", () => {
    const candidates = followUpCandidates([job("j1", "DECLINED", null)], []);
    expect(candidates).toEqual([{ jobId: "j1", jobTitle: "job j1", quotedPriceSatang: null }]);
  });

  it("mints ungrouped wear findings, and ones stuck on a still-PROPOSED job", () => {
    const candidates = followUpCandidates(
      [],
      [wear("f1", null, "DUE_SOON"), wear("f2", "PROPOSED")],
    );
    expect(candidates).toEqual([
      { findingId: "f1", checklistItem: "brakes", condition: "DUE_SOON" },
      { findingId: "f2", checklistItem: "brakes", condition: "NEEDS_WORK" },
    ]);
  });

  it("never double-mints: a finding on a DECLINED job is covered by the job row", () => {
    const candidates = followUpCandidates([job("j1", "DECLINED")], [wear("f1", "DECLINED")]);
    expect(candidates).toEqual([
      { jobId: "j1", jobTitle: "job j1", quotedPriceSatang: 1_800_000 },
    ]);
  });

  it("actioned wear is not chased: authorized-or-beyond and CANCELLED are excluded", () => {
    const candidates = followUpCandidates(
      [],
      [wear("f1", "COMPLETED"), wear("f2", "IN_PROGRESS"), wear("f3", "CANCELLED")],
    );
    expect(candidates).toEqual([]);
  });

  it("damage-map findings never mint — wear items only (CONTEXT.md)", () => {
    const candidates = followUpCandidates(
      [],
      [
        {
          id: "f1",
          source: "DAMAGE_MAP",
          checklistItem: null,
          condition: null,
          jobStatus: null,
        },
      ],
    );
    expect(candidates).toEqual([]);
  });

  it("a fully actioned case mints nothing", () => {
    const candidates = followUpCandidates(
      [job("j1", "COMPLETED"), job("j2", "CANCELLED")],
      [wear("f1", "COMPLETED")],
    );
    expect(candidates).toEqual([]);
  });
});
