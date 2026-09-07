"use client";

import { useState } from "react";
import type { ArrivalQueueRow } from "@/lib/arrivals";
import { dismissArrival } from "./actions";
import { ArrivalQueue } from "./arrival-queue";
import { CheckinWizard } from "./checkin-wizard";

/**
 * The check-in page's client shell (M7.8 §4): the queue strip and the
 * wizard share one piece of state — which Arrival, if any, is being pulled
 * in. With no waiting Arrivals the strip is absent and the page is the
 * wizard alone, exactly as before.
 */
export function CheckinScreen({ initialQueue }: { initialQueue: ArrivalQueueRow[] }) {
  const [queue, setQueue] = useState(initialQueue);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = queue.find((row) => row.id === selectedId) ?? null;

  async function dismiss(row: ArrivalQueueRow) {
    const res = await dismissArrival(row.id);
    // Gone either way: dismissed now, or already handled elsewhere.
    if (res.ok || res.error === "arrivalGone") {
      setQueue((rows) => rows.filter((r) => r.id !== row.id));
      if (selectedId === row.id) setSelectedId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {queue.length > 0 && (
        <ArrivalQueue
          rows={queue}
          selectedId={selectedId}
          onPull={(row) => setSelectedId(row.id)}
          onDismiss={dismiss}
        />
      )}
      {/* Keyed by the Arrival: pulling one in mounts a fresh wizard prefilled
          from it; "start from nothing" mounts the empty one. */}
      <CheckinWizard
        key={selected?.id ?? "none"}
        arrival={selected}
        onClearArrival={() => setSelectedId(null)}
      />
    </div>
  );
}
