import { describe, expect, it } from "vitest";
import {
  ageToneFor,
  matchesSearch,
  sortBoard,
  spineSummary,
  toBoardCase,
  type BoardCaseInput,
} from "@/lib/board";
import type { JobStatus } from "@/lib/generated/prisma/enums";

const NOW = new Date("2026-09-10T08:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function job(
  status: JobStatus,
  extra: Partial<BoardCaseInput["jobs"][number]> = {},
): BoardCaseInput["jobs"][number] {
  return {
    id: `job-${status}-${Math.random()}`,
    title: "Front bumper — repaint",
    status,
    waitingReason: null,
    payerType: "CUSTOMER",
    insurerName: null,
    priceSatang: 1_850_000,
    assignedStaff: null,
    partLines: [],
    ...extra,
  };
}

function base(extra: Partial<BoardCaseInput> = {}): BoardCaseInput {
  return {
    id: "case-1",
    reference: "RC-1005",
    status: "CHECKED_IN",
    checkedInAt: daysAgo(14),
    readyAt: null,
    deliveredAt: null,
    vehicle: { plate: "4ข2312", make: "BMW", model: "420e", bodyType: "SEDAN" },
    contactCustomer: { name: "Gun", phone: "0816897027" },
    photos: [{ id: "photo-1" }],
    findings: [{ confirmedAt: daysAgo(13) }],
    jobs: [],
    quotations: [],
    quotationSends: [],
    payments: [],
    ...extra,
  };
}

describe("toBoardCase: the row's one pill follows the next action", () => {
  it("a fresh check-in asks to inspect", () => {
    const row = toBoardCase(base({ findings: [], checkedInAt: new Date(NOW.getTime() - 40 * 60_000) }), NOW);
    expect(row.stage).toBe("IN_ASSESSMENT");
    expect(row.pill).toEqual({ kind: "INSPECT" });
    expect(row.next.primary).toBe("OPEN_INSPECTION");
    expect(row.ageDays).toBe(0);
    expect(row.ageTone).toBe("quiet");
    expect(row.needsMe).toBe(true);
  });

  it("accepted findings proposing no work leave nothing to do", () => {
    const row = toBoardCase(base(), NOW);
    expect(row.stage).toBe("IN_ASSESSMENT");
    expect(row.pill).toEqual({ kind: "NO_WORK" });
    expect(row.next.primary).toBeNull();
  });

  it("unpriced lines outrank sending", () => {
    const row = toBoardCase(base({ jobs: [job("PROPOSED", { priceSatang: null }), job("PROPOSED")] }), NOW);
    expect(row.pill).toEqual({ kind: "UNPRICED", count: 1 });
    expect(row.next.primary).toBe("SET_PRICES");
  });

  it("a priced, unsent offer says not sent with its total", () => {
    const row = toBoardCase(base({ jobs: [job("PROPOSED"), job("PROPOSED")] }), NOW);
    expect(row.pill).toEqual({ kind: "NOT_SENT", amountSatang: 3_700_000 });
    expect(row.offerTotalSatang).toBe(3_700_000);
  });

  it("a sent offer counts the days since the send", () => {
    const j = job("PROPOSED");
    const row = toBoardCase(
      base({
        jobs: [j],
        quotations: [{ lines: [{ jobId: j.id, priceSatang: j.priceSatang! }] }],
        quotationSends: [{ sentAt: daysAgo(13) }],
      }),
      NOW,
    );
    expect(row.pill).toEqual({ kind: "UNANSWERED", days: 13 });
    expect(row.next.primary).toBe("RECORD_RESPONSE");
    expect(row.quoteSentAt).toBe(daysAgo(13).toISOString());
  });

  it("waiting on parts shows the part rollup and the nearest ETA; the advisor is not needed", () => {
    const eta = daysAgo(-2);
    const row = toBoardCase(
      base({
        jobs: [
          job("WAITING", {
            waitingReason: "PARTS",
            assignedStaff: { name: "Nok" },
            partLines: [
              { orderStatus: "ARRIVED", etaDate: null },
              { orderStatus: "ORDERED", etaDate: eta },
              { orderStatus: "NOT_ORDERED", etaDate: null },
            ],
          }),
        ],
      }),
      NOW,
    );
    expect(row.stage).toBe("WAITING");
    expect(row.pill).toEqual({ kind: "WAITING_PARTS", arrived: 1, total: 3, eta: eta.toISOString() });
    expect(row.needsMe).toBe(false);
    expect(row.technicians).toEqual(["Nok"]);
  });

  it("ready and owed collects; ready and settled nudges after three days", () => {
    const owed = toBoardCase(base({ status: "READY", readyAt: daysAgo(1), jobs: [job("COMPLETED")] }), NOW);
    expect(owed.pill).toEqual({ kind: "COLLECT", amountSatang: 1_850_000 });
    expect(owed.next).toEqual({ primary: "RECORD_PAYMENT", secondary: "MARK_DELIVERED" });

    const paid = { payerType: "CUSTOMER" as const, amountSatang: 1_850_000, voidedAt: null };
    const fresh = toBoardCase(base({ status: "READY", readyAt: daysAgo(1), jobs: [job("COMPLETED")], payments: [paid] }), NOW);
    expect(fresh.pill).toEqual({ kind: "DELIVER" });
    const stale = toBoardCase(base({ status: "READY", readyAt: daysAgo(11), jobs: [job("COMPLETED")], payments: [paid] }), NOW);
    expect(stale.pill).toEqual({ kind: "NOT_COLLECTED", days: 11 });
  });

  it("a delivered case still owed money ages from delivery and names the bigger payer", () => {
    const row = toBoardCase(
      base({
        status: "DELIVERED",
        checkedInAt: daysAgo(30),
        deliveredAt: daysAgo(12),
        jobs: [job("COMPLETED", { payerType: "INSURER", insurerName: "Viriyah", priceSatang: 3_620_000 })],
      }),
      NOW,
    );
    expect(row.stage).toBe("BALANCE_DUE");
    expect(row.ageDays).toBe(12);
    expect(row.pill).toEqual({ kind: "OWED", payer: "INSURER", amountSatang: 3_620_000 });
  });

  it("ledger splits offer / work / done", () => {
    const row = toBoardCase(
      base({ jobs: [job("PROPOSED"), job("IN_PROGRESS", { assignedStaff: { name: "Bird" } }), job("COMPLETED"), job("DECLINED")] }),
      NOW,
    );
    expect(row.ledger.offer).toHaveLength(1);
    expect(row.ledger.work).toHaveLength(1);
    expect(row.ledger.work[0]!.technician).toBe("Bird");
    expect(row.ledger.done).toHaveLength(2);
  });
});

describe("age tones (D-26)", () => {
  it("quiet under 3, muted to 6, amber to 13, red from 14", () => {
    expect(ageToneFor(0)).toBe("quiet");
    expect(ageToneFor(2)).toBe("quiet");
    expect(ageToneFor(3)).toBe("muted");
    expect(ageToneFor(7)).toBe("warn");
    expect(ageToneFor(13)).toBe("warn");
    expect(ageToneFor(14)).toBe("bad");
  });
});

describe("sortBoard and the spine", () => {
  const rows = [
    toBoardCase(base({ id: "b", jobs: [job("PROPOSED")], checkedInAt: daysAgo(2) }), NOW),
    toBoardCase(base({ id: "a", jobs: [job("PROPOSED")], checkedInAt: daysAgo(9) }), NOW),
    toBoardCase(base({ id: "c", findings: [], checkedInAt: daysAgo(0) }), NOW),
    toBoardCase(base({ id: "d", jobs: [job("IN_PROGRESS", { assignedStaff: { name: "Bird" } })] }), NOW),
  ];
  it("orders by D-2 precedence, then oldest first", () => {
    expect(sortBoard(rows).map((row) => row.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("sums the segment's money and lights the ones needing a human", () => {
    const spine = spineSummary(rows);
    const auth = spine.find((s) => s.segment === "AUTHORIZATION")!;
    expect(auth.count).toBe(2);
    expect(auth.amountSatang).toBe(3_700_000);
    expect(auth.oldestDays).toBe(9);
    expect(auth.hot).toBe(true);
    const work = spine.find((s) => s.segment === "WORK")!;
    expect(work.hot).toBe(false);
    expect(work.technicians).toEqual(["Bird"]);
  });
  it("search ignores spacing and dashes across plate, phone, name, reference", () => {
    const row = rows[0]!;
    expect(matchesSearch(row, "4ข 2312")).toBe(true);
    expect(matchesSearch(row, "081-689")).toBe(true);
    expect(matchesSearch(row, "gun")).toBe(true);
    expect(matchesSearch(row, "rc-1005")).toBe(true);
    expect(matchesSearch(row, "toyota")).toBe(false);
  });
});
