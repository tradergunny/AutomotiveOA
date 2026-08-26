"use client";

import { Flag, PackageCheck } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { markCaseDelivered, markCaseReady, type FlowError, type FlowResult } from "./flow-actions";

/**
 * The case's explicit flow actions (M5 brief §4): Mark ready (the
 * customer-collects-anyway path — auto-READY handles completed work) and
 * Mark delivered (always explicit, ruling 4b). Two-tap confirm, M4's arm
 * idiom; the server re-render after revalidatePath updates everything else.
 */
export function CaseFlowPanel({
  caseId,
  canMarkReady,
  canDeliver,
}: {
  caseId: string;
  canMarkReady: boolean;
  canDeliver: boolean;
}) {
  const t = useTranslations("cases.flow");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<"ready" | "deliver" | null>(null);
  const [error, setError] = useState<FlowError | null>(null);

  if (!canMarkReady && !canDeliver) return null;

  async function run(action: () => Promise<FlowResult<{ status: string }>>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) setError(res.error);
    } finally {
      setBusy(false);
    }
  }

  function arm(kind: "ready" | "deliver", go: () => void) {
    if (armed !== kind) {
      setArmed(kind);
      setTimeout(() => setArmed((cur) => (cur === kind ? null : cur)), 4000);
      return;
    }
    setArmed(null);
    go();
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed pt-3">
      {canMarkReady && (
        <button
          type="button"
          disabled={busy}
          onClick={() => arm("ready", () => void run(() => markCaseReady(caseId)))}
          className={cn(
            "flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold",
            armed === "ready"
              ? "border-ok/60 bg-ok/15 text-ok"
              : "border-border-strong text-muted-foreground hover:border-ok/50 hover:text-ok",
          )}
        >
          <Flag className="size-3.5" aria-hidden />
          {armed === "ready" ? t("markReadyConfirm") : t("markReady")}
        </button>
      )}
      {canDeliver && (
        <button
          type="button"
          disabled={busy}
          onClick={() => arm("deliver", () => void run(() => markCaseDelivered(caseId)))}
          className={cn(
            "flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold",
            armed === "deliver"
              ? "border-primary bg-primary-soft text-primary"
              : "border-primary-dim text-primary hover:bg-primary-soft",
          )}
        >
          <PackageCheck className="size-3.5" aria-hidden />
          {armed === "deliver" ? t("markDeliveredConfirm") : t("markDelivered")}
        </button>
      )}
      {error && (
        <span role="alert" className="border border-bad/45 px-2 py-0.5 text-[11px] text-bad">
          {t(`errors.${error}`)}
        </span>
      )}
    </div>
  );
}
