"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { StageAction } from "@/lib/case-flow";

/**
 * How the header's next-action strip reaches the Jobs section (D-22:
 * "header actions do the thing"). The strip asks for an action; the Jobs
 * panel answers it — Set prices scrolls to the Offer and focuses the first
 * empty cell, the other three open their dialogs. A counter rides along so
 * asking for the same action twice still fires twice.
 */

export type JobsFlowRequest = { action: StageAction; nonce: number };

type JobsFlow = {
  request: JobsFlowRequest | null;
  ask: (action: StageAction) => void;
};

const JobsFlowContext = createContext<JobsFlow | null>(null);

export function JobsFlowProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<JobsFlowRequest | null>(null);
  const ask = useCallback((action: StageAction) => {
    setRequest((current) => ({ action, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);
  const value = useMemo(() => ({ request, ask }), [request, ask]);
  return <JobsFlowContext.Provider value={value}>{children}</JobsFlowContext.Provider>;
}

export function useJobsFlow(): JobsFlow {
  const context = useContext(JobsFlowContext);
  if (!context) throw new Error("useJobsFlow must sit under JobsFlowProvider");
  return context;
}
