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
 * M7.10: both are Milestone messages (ADR-007), so each opens one small
 * dialog in D-23's shape asking the one thing the server can use — an
 * optional note to the customer, appended to the message — and naming who
 * receives it. M4's arm-then-confirm idiom retires here: the dialog is the
 * confirmation.
 */
type Act = "ready" | "deliver";

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
  const [dialog, setDialog] = useState<Act | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<FlowError | null>(null);

  if (!canMarkReady && !canDeliver) return null;

  function close() {
    setDialog(null);
    setNote("");
    setError(null);
  }

  async function confirm(act: Act) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res: FlowResult<{ status: string }> =
        act === "ready" ? await markCaseReady(caseId, { note }) : await markCaseDelivered(caseId, { note });
      if (!res.ok) setError(res.error);
      else close();
    } finally {
      setBusy(false);
    }
  }

  const copy = dialog === "deliver" ? "deliverDialog" : "readyDialog";
  const Icon = dialog === "deliver" ? PackageCheck : Flag;

  return (
    <>
      {canDeliver && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setDialog("deliver")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold",
            deliverPrimary
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "border border-primary-dim text-primary hover:bg-primary-soft",
          )}
        >
          <PackageCheck className="size-3.5" aria-hidden />
          {t("markDelivered")}
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

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        {dialog && (
          <DialogContent width="sm" title={t(`${copy}.title`)} description={t(`${copy}.question`)}>
            <DialogBody>
              <p className="text-[12px]">{t(`${copy}.question`)}</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.currentTarget.value.slice(0, NOTE_MAX_LENGTH))}
                placeholder={t(`${copy}.notePlaceholder`)}
                rows={2}
                maxLength={NOTE_MAX_LENGTH}
                className="w-full resize-y border bg-background px-2.5 py-2 text-[13px] leading-relaxed placeholder:text-faint focus:border-primary focus:outline-none"
              />
              <p className="text-[10.5px] text-faint">{t(`${copy}.noteHint`, { name: recipientName })}</p>
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
                onClick={() => void confirm(dialog)}
              >
                <Icon data-icon="inline-start" />
                {busy ? t(`${copy}.working`) : t(`${copy}.confirm`)}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={close}>
                {tc("cancel")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
