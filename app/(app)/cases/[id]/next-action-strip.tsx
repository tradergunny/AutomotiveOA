"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { NextMove, StageAction } from "@/lib/case-flow";
import { cn } from "@/lib/utils";
import { useJobsFlow } from "./jobs-flow-context";

/**
 * The header's next-action strip (D-6, as amended 2026-09-02): one primary,
 * at most one secondary — a suggestion, never a wizard. Since M7.7 the Jobs
 * actions open their dialogs instead of scrolling to an anchor (D-22):
 * Set prices scrolls to the Offer and focuses the first empty cell, Send
 * quotation and Record response open their dialogs. Open inspection stays a
 * link; Record QC and Record payment still scroll to where they live.
 * MARK_DELIVERED is rendered by CaseFlowPanel beside this.
 */
export function NextActionStrip({ caseId, move }: { caseId: string; move: NextMove }) {
  const t = useTranslations("cases");
  const { ask } = useJobsFlow();

  const label: Record<Exclude<StageAction, "MARK_DELIVERED">, string> = {
    OPEN_INSPECTION: t("action.openInspection"),
    SET_PRICES: t("action.setPrices"),
    SEND_QUOTATION: t("action.sendQuotation"),
    RECORD_RESPONSE: t("action.recordResponse"),
    RECORD_QC: t("action.recordQc"),
    RECORD_PAYMENT: t("action.recordPayment"),
  };

  const render = (action: StageAction, primary: boolean) => {
    if (action === "MARK_DELIVERED") return null;
    const cls = cn(
      "px-3 py-1.5 text-xs font-semibold transition-colors active:translate-y-px",
      primary
        ? "bg-primary text-primary-foreground hover:bg-primary/90"
        : "border border-primary-dim text-primary hover:bg-primary-soft",
    );
    if (action === "OPEN_INSPECTION") {
      return (
        <Link key={action} href={`/cases/${caseId}/inspection`} className={cls}>
          {label[action]}
        </Link>
      );
    }
    if (action === "RECORD_QC" || action === "RECORD_PAYMENT") {
      return (
        <a key={action} href={action === "RECORD_QC" ? "#jobs" : "#money"} className={cls}>
          {label[action]}
        </a>
      );
    }
    return (
      <button key={action} type="button" onClick={() => ask(action)} className={cls}>
        {label[action]}
      </button>
    );
  };

  return (
    <>
      {move.primary && render(move.primary, true)}
      {move.secondary && render(move.secondary, false)}
    </>
  );
}
