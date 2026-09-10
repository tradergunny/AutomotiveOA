"use client";

import { Flag, PackageCheck } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { NOTE_MAX_LENGTH } from "@/lib/line-draft";
import { cn } from "@/lib/utils";
import { markCaseDelivered, markCaseReady, type FlowError, type FlowResult } from "./flow-actions";

/**
 * The case's explicit flow actions (M5 brief §4), folded into the header's
 * next-action strip (M7.5, D-6): Mark ready (the customer-collects-anyway
 * path — auto-READY handles completed work) and Mark delivered (always
 * explicit, ruling 4b). Renders bare inline buttons — the strip owns the
 * layout.
 *
 * M7.10: Ready is a Milestone message (ADR-007), so Mark ready opens a small
 * dialog in D-23's shape asking the one thing the server can use — an
 * optional note to the customer, appended to the Ready message — and names
 * who receives it. Mark delivered keeps M4's arm idiom until step 6 gives it
 * the same dialog.
 */
export function CaseFlowPanel({
  caseId,
  canMarkReady,
  canDeliver,
  deliverPrimary,
  recipientName,
}: {
  caseId: string;
  canMarkReady: boolean;
  canDeliver: boolean;
  /** True when Mark delivered is the stage's suggested move (READY, settled). */
  deliverPrimary: boolean;
  /** The contact customer — the Milestone message's named recipient. */
  recipientName: string;
}) {
  const t = useTranslations("cases.flow");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<"deliver" | null>(null);
  const [dialog, setDialog] = useState<"ready" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<FlowError | null>(null);

  if (!canMarkReady && !canDeliver) return null;

  async function run(action: () => Promise<FlowResult<{ status: string }>>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) setError(res.error);
      return res.ok;
    } finally {
      setBusy(false);
    }
  }

  function arm(kind: "deliver", go: () => void) {
    if (armed !== kind) {
      setArmed(kind);
      setTimeout(() => setArmed((cur) => (cur === kind ? null : cur)), 4000);
      return;
    }
    setArmed(null);
    go();
  }

  async function confirmReady() {
    const ok = await run(() => markCaseReady(caseId, { note }));
    if (ok) {
      setDialog(null);
      setNote("");
    }
  }

  return (
    <>
      {canDeliver && (
        <button
          type="button"
          disabled={busy}
          onClick={() => arm("deliver", () => void run(() => markCaseDelivered(caseId)))}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold",
            armed === "deliver"
              ? "border border-primary bg-primary-soft text-primary"
              : deliverPrimary
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-primary-dim text-primary hover:bg-primary-soft",
          )}
        >
          <PackageCheck className="size-3.5" aria-hidden />
          {armed === "deliver" ? t("markDeliveredConfirm") : t("markDelivered")}
        </button>
      )}
      {canMarkReady && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setDialog("ready")}
          className="flex items-center gap-1.5 border border-border-strong px-2.5 py-1.5 text-xs text-muted-foreground hover:border-ok/50 hover:text-ok"
        >
          <Flag className="size-3.5" aria-hidden />
          {t("markReady")}
        </button>
      )}
      {error && dialog === null && (
        <span role="alert" className="border border-bad/45 px-2 py-0.5 text-[11px] text-bad">
          {t(`errors.${error}`)}
        </span>
      )}

      <Dialog
        open={dialog === "ready"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setNote("");
            setError(null);
          }
        }}
      >
        {dialog === "ready" && (
          <DialogContent width="sm" title={t("readyDialog.title")} description={t("readyDialog.question")}>
            <DialogBody>
              <p className="text-[12px]">{t("readyDialog.question")}</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.currentTarget.value.slice(0, NOTE_MAX_LENGTH))}
                placeholder={t("readyDialog.notePlaceholder")}
                rows={2}
                maxLength={NOTE_MAX_LENGTH}
                className="w-full resize-y border bg-background px-2.5 py-2 text-[13px] leading-relaxed placeholder:text-faint focus:border-primary focus:outline-none"
              />
              <p className="text-[10.5px] text-faint">{t("readyDialog.noteHint", { name: recipientName })}</p>
              {error && (
                <p role="alert" className="border border-bad/45 px-2 py-1 text-[11px] text-bad">
                  {t(`errors.${error}`)}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                className="h-8 font-semibold"
                onClick={() => void confirmReady()}
              >
                <Flag data-icon="inline-start" />
                {busy ? t("readyDialog.working") : t("readyDialog.confirm")}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setDialog(null)}>
                {tc("cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
