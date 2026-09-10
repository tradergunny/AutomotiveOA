"use client";

import { ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { extractNote } from "@/lib/line-draft";
import { cn } from "@/lib/utils";
import type { SentUpdateDto } from "./line-actions";
import { SendMessageDialog } from "./send-message-dialog";

/**
 * Customer Updates (D-29): the record of what the customer heard — every
 * LINE Update, sent or not-sent, whether the system carried it (ADR-007) or
 * Staff wrote it — as a compact log. One line per Update: status, kind,
 * time, photo count, whether a note rode along; expanding to the Thai body
 * and thumbnails. Opens as the last message plus expand, exactly as
 * Activity does (D-10). Free-form sending is one small button opening the
 * Send-a-message dialog; the composer, its preview and its double press
 * retired here. Built in D-27's language.
 */

export type ComposerPhoto = {
  id: string;
  contentType: string;
  /** Where the photo came from, so staff know what they are attaching. */
  origin: "case" | "finding" | "job";
};

export type SendBlockedReason = "notConnected" | "noIdentity" | "unfollowed" | null;

/** Set when the page was opened from the Follow-up worklist (M7 §6). */
export type ComposerFollowUp = { id: string; label: string };

type Status = SentUpdateDto["deliveryStatus"];

const STATUS_TONE: Record<Status, string> = {
  SENT: "bg-ok/15 text-ok",
  NOT_SENT: "bg-warn/15 text-warn",
  FAILED: "bg-bad/15 text-bad",
};

export function CustomerTimeline({
  caseId,
  initialUpdates,
  draftBody,
  photos,
  recipientName,
  blockedReason,
  maxPhotos,
  followUp,
}: {
  caseId: string;
  /** Newest first. */
  initialUpdates: SentUpdateDto[];
  draftBody: string;
  photos: ComposerPhoto[];
  recipientName: string;
  blockedReason: SendBlockedReason;
  maxPhotos: number;
  followUp: ComposerFollowUp | null;
}) {
  const t = useTranslations("customerTimeline");
  const format = useFormatter();

  const [updates, setUpdates] = useState(initialUpdates);
  // Sends can come from elsewhere on the page (Send quotation, the flow
  // acts) and arrive through the server re-render: take the fresh list
  // whenever the props change.
  const [seenUpdates, setSeenUpdates] = useState(initialUpdates);
  if (initialUpdates !== seenUpdates) {
    setSeenUpdates(initialUpdates);
    setUpdates(initialUpdates);
  }
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // The Follow-up deep link opens the dialog pre-filled with the chase draft.
  const [dialog, setDialog] = useState(followUp !== null);

  // Collapsed shows only the newest message (D-10) — the list is descending.
  const visible = open ? updates : updates.slice(0, 1);

  return (
    <section className="rounded-[14px] border bg-card lift">
      <header className="flex items-center gap-2.5 px-4 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={updates.length <= 1}
          className="flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold hover:text-primary disabled:cursor-default disabled:hover:text-foreground"
        >
          {open ? (
            <ChevronDown className="size-3.5 text-faint" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 text-faint" aria-hidden />
          )}
          {t("title")}
        </button>
        <span className="num text-[10.5px] text-faint">{t("count", { count: updates.length })}</span>
        <button
          type="button"
          onClick={() => setDialog(true)}
          className="ml-auto flex items-center gap-1.5 rounded-full border border-primary-dim px-2.5 py-1 text-[11.5px] font-semibold text-primary hover:bg-primary-soft"
        >
          <MessageSquarePlus className="size-3.5" aria-hidden />
          {t("sendMessage")}
        </button>
      </header>

      {updates.length === 0 ? (
        <p className="border-t border-dashed px-4 py-3 text-xs text-faint sm:px-5">{t("empty")}</p>
      ) : (
        <ol className="border-t border-dashed">
          {visible.map((update) => {
            const isOpen = expanded === update.id;
            const note = extractNote(update.kind, update.bodyText);
            const reason =
              update.deliveryStatus === "NOT_SENT" && update.errorCode
                ? t.has(`reason.${update.errorCode}` as never)
                  ? t(`reason.${update.errorCode}` as never)
                  : update.errorCode
                : null;
            return (
              <li key={update.id} className="border-b border-dashed last:border-0">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : update.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? t("collapse") : t("expand")}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-surface-2/50 sm:px-5"
                >
                  <span
                    className={cn(
                      "inline-flex flex-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                      STATUS_TONE[update.deliveryStatus],
                    )}
                  >
                    <span aria-hidden className="size-1.5 rounded-full bg-current" />
                    {t(`status.${update.deliveryStatus}`)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {update.kind === "QUOTATION"
                      ? t("kind.QUOTATION", { label: update.quotationLabel ?? "—" })
                      : t(`kind.${update.kind}`)}
                    {reason && <span className="ml-1.5 font-normal text-warn">· {reason}</span>}
                  </span>
                  <span className="num flex flex-none items-center gap-1.5 text-[10.5px] text-faint">
                    {update.photoIds.length > 0 && (
                      <span>{t("photoCount", { count: update.photoIds.length })} ·</span>
                    )}
                    {note && <span>{t("withNote")} ·</span>}
                    {format.dateTime(new Date(update.sentAt), {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {isOpen ? (
                    <ChevronDown className="size-3.5 flex-none text-faint" aria-hidden />
                  ) : (
                    <ChevronRight className="size-3.5 flex-none text-faint" aria-hidden />
                  )}
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-2 px-4 pb-3 pl-9 sm:px-5 sm:pl-10">
                    <p
                      className={cn(
                        "whitespace-pre-wrap text-[13px] leading-relaxed",
                        update.deliveryStatus !== "SENT" && "text-muted-foreground",
                      )}
                    >
                      {update.bodyText}
                    </p>
                    {update.photoIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {update.photoIds.map((photoId) => (
                          // eslint-disable-next-line @next/next/no-img-element -- bytes come from our authenticated route; next/image would re-fetch without the session cookie
                          <img
                            key={photoId}
                            src={`/api/photos/${photoId}`}
                            alt=""
                            loading="lazy"
                            className="size-14 rounded-[8px] border object-cover"
                          />
                        ))}
                      </div>
                    )}
                    {update.deliveryStatus === "NOT_SENT" && (
                      <p className="text-[11px] text-warn">{t("notSentHint", { reason: reason ?? "—" })}</p>
                    )}
                    {update.deliveryStatus === "FAILED" && (
                      <p className="text-[11px] text-bad">{t("failedHint", { code: update.errorCode ?? "—" })}</p>
                    )}
                    <p className="text-[10.5px] text-faint">
                      {t("by", { name: update.sentByName })} · {update.recipientName}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={dialog} onOpenChange={(next) => !next && setDialog(false)}>
        {dialog && (
          <SendMessageDialog
            caseId={caseId}
            recipientName={recipientName}
            initialBody={draftBody}
            photos={photos}
            blockedReason={blockedReason}
            maxPhotos={maxPhotos}
            followUp={followUp}
            onSent={(update) => {
              setUpdates((list) => [update, ...list]);
              setDialog(false);
            }}
            onClose={() => setDialog(false)}
          />
        )}
      </Dialog>
    </section>
  );
}
