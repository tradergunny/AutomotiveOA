"use client";

import { Eye, FileText, ImageOff, MessageCircle, PhoneOutgoing, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { sendLineUpdate, type SendUpdateError, type SentUpdateDto } from "./line-actions";

/**
 * The Customer Timeline and its composer (M6 brief §6 + §9) — the curated
 * half of CONTEXT.md's two narratives, and the only surface in the product
 * that a customer ever sees the output of.
 *
 * ADR-003 lives here in the interaction itself: the draft is pre-filled, and
 * nothing leaves until a person reads it and presses send twice. The body is
 * Thai-first data (DESIGN.md) — it stays Thai whatever locale the staff
 * member is using — while every label around it is bilingual.
 *
 * Since M7 (decision 5) the composer works on DELIVERED cases too — most
 * follow-up-worthy cases are delivered — and a Follow-up deep link arrives
 * with a pre-filled chase draft; its successful send flips the worklist row
 * to CONTACTED server-side.
 */

export type ComposerPhoto = {
  id: string;
  contentType: string;
  /** Where the photo came from, so staff know what they are attaching. */
  origin: "case" | "finding" | "job";
};

export type SendBlockedReason = "notConnected" | "noIdentity" | "unfollowed" | null;

/** Set when the composer was opened from the Follow-up worklist (M7 §6). */
export type ComposerFollowUp = { id: string; label: string };

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
  // Sends can come from elsewhere on the page (Send quotation, M7.7) and
  // arrive here through the server re-render: take the fresh list whenever
  // the props change, while the draft being typed stays untouched.
  const [seenUpdates, setSeenUpdates] = useState(initialUpdates);
  if (initialUpdates !== seenUpdates) {
    setSeenUpdates(initialUpdates);
    setUpdates(initialUpdates);
  }
  const [body, setBody] = useState(draftBody);
  const [selected, setSelected] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SendUpdateError | null>(null);

  const sendable = photos.filter((photo) => isSendable(photo.contentType));
  const rejected = photos.length - sendable.length;
  const capReached = selected.length >= maxPhotos;

  function toggle(photoId: string) {
    setError(null);
    setSelected((current) => {
      if (current.includes(photoId)) return current.filter((id) => id !== photoId);
      if (current.length >= maxPhotos) {
        setError("tooManyPhotos");
        return current;
      }
      return [...current, photoId];
    });
  }

  async function send() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("body", body);
      if (followUp) formData.set("followUpId", followUp.id);
      for (const photoId of selected) formData.append("photoId", photoId);
      const res = await sendLineUpdate(caseId, formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setUpdates((list) => [res.value, ...list]);
      setSelected([]);
      setShowPreview(false);
    } finally {
      setPending(false);
    }
  }

  const sent = updates.filter((update) => update.deliveryStatus === "SENT");

  return (
    <section className="border bg-card">
      <header className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 sm:px-5">
        <MessageCircle className="size-3.5 text-primary" aria-hidden />
        <h3 className="text-[13px] font-semibold">{t("title")}</h3>
        <span className="border border-dashed border-primary-dim px-1.5 py-px font-mono text-[9px] tracking-wider text-primary">
          {t("customerVisible")}
        </span>
        <span className="num ml-auto text-[10.5px] text-faint">
          {t("sentCount", { count: sent.length })}
        </span>
      </header>

      {updates.length === 0 ? (
        <p className="border-t border-dashed px-4 py-3 text-xs text-faint sm:px-5">
          {t("empty")}
        </p>
      ) : (
        <ol className="border-t border-dashed">
          {updates.map((update) => (
            <li
              key={update.id}
              className="flex flex-col gap-1.5 border-b border-dashed px-4 py-2.5 last:border-0 sm:px-5"
            >
              <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
                {update.deliveryStatus === "FAILED" ? (
                  <span className="flex items-center gap-1 border border-bad/45 px-1.5 py-px text-bad">
                    <TriangleAlert className="size-3" aria-hidden />
                    {t("failed")}
                  </span>
                ) : (
                  <span className="border border-ok/45 px-1.5 py-px text-ok">{t("sent")}</span>
                )}
                <span>{update.recipientName}</span>
                {update.quotationLabel && (
                  <span className="flex items-center gap-1 border border-primary-dim px-1.5 py-px font-mono text-[10px] text-primary">
                    <FileText className="size-3" aria-hidden />
                    {t("quotationLabel", { label: update.quotationLabel })}
                  </span>
                )}
                <span className="num ml-auto">
                  {format.dateTime(new Date(update.sentAt), {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {update.sentByName}
                </span>
              </div>
              <p
                className={cn(
                  "whitespace-pre-wrap text-[13px]",
                  update.deliveryStatus === "FAILED" && "text-muted-foreground line-through",
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
                      className="size-14 border object-cover"
                    />
                  ))}
                </div>
              )}
              {update.deliveryStatus === "FAILED" && (
                <p className="text-[11px] text-bad">
                  {t("failedHint", { code: update.errorCode ?? "—" })}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-col gap-2.5 border-t bg-surface-2/40 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("composeTitle")}</span>
            <span className="text-[11px] text-faint">
              {t("recipient", { name: recipientName })}
            </span>
          </div>

          {followUp && (
            <p className="flex items-center gap-2 border border-primary-dim bg-primary-soft/40 px-2.5 py-1.5 text-[11.5px] text-primary">
              <PhoneOutgoing className="size-3.5 flex-none" aria-hidden />
              {t("followupContext", { label: followUp.label })}
            </p>
          )}

          {blockedReason && (
            <p
              role="status"
              className="flex items-start gap-2 border border-warn/45 px-2.5 py-2 text-[11.5px] text-warn"
            >
              <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden />
              {t(`blocked.${blockedReason}`)}
            </p>
          )}

          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={7}
            spellCheck={false}
            className="w-full resize-y border bg-background px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-primary-dim"
            aria-label={t("bodyLabel")}
          />
          <p className="text-[11px] text-faint">{t("draftHint")}</p>

          {sendable.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="num text-[11px] text-faint">
                {t("photosTitle", { selected: selected.length, max: maxPhotos })}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {sendable.map((photo) => {
                  const index = selected.indexOf(photo.id);
                  const chosen = index >= 0;
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => toggle(photo.id)}
                      disabled={!chosen && capReached}
                      className={cn(
                        "relative size-16 border",
                        chosen ? "border-primary" : "border-border hover:border-border-strong",
                        !chosen && capReached && "opacity-40",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated photo route, see above */}
                      <img
                        src={`/api/photos/${photo.id}`}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                      {chosen && (
                        <span className="num absolute right-0 top-0 bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                          {index + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {rejected > 0 && (
                <p className="flex items-center gap-1.5 text-[11px] text-faint">
                  <ImageOff className="size-3" aria-hidden />
                  {t("photosRejected", { count: rejected })}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((value) => !value)}
              className="flex items-center gap-1.5 border border-border-strong px-2.5 py-1 text-xs text-muted-foreground hover:border-primary-dim hover:text-primary"
            >
              <Eye className="size-3.5" aria-hidden />
              {showPreview ? t("hidePreview") : t("preview")}
            </button>
            <button
              type="button"
              disabled={pending || !!blockedReason || !body.trim()}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  setTimeout(() => setArmed(false), 5000);
                  return;
                }
                setArmed(false);
                void send();
              }}
              className={cn(
                "flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold disabled:opacity-40",
                armed
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-primary-dim text-primary hover:bg-primary-soft",
              )}
            >
              <Send className="size-3.5" aria-hidden />
              {pending
                ? t("sending")
                : armed
                  ? t("sendConfirm", { name: recipientName })
                  : t("send")}
            </button>
            {error && (
              <span role="alert" className="border border-bad/45 px-2 py-0.5 text-[11px] text-bad">
                {t(`errors.${error}`)}
              </span>
            )}
          </div>

          {showPreview && (
            <div className="flex flex-col gap-1.5 border border-dashed px-2.5 py-2">
              <span className="text-[11px] text-faint">{t("previewTitle")}</span>
              <p className="whitespace-pre-wrap border bg-background px-2.5 py-2 text-[13px] leading-relaxed">
                {body}
              </p>
              {selected.map((photoId, index) => (
                <div key={photoId} className="flex items-center gap-2">
                  <span className="num text-[10px] text-faint">{index + 2}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated photo route, see above */}
                  <img
                    src={`/api/photos/${photoId}`}
                    alt=""
                    loading="lazy"
                    className="size-20 border object-cover"
                  />
                </div>
              ))}
            </div>
          )}
      </div>
    </section>
  );
}

/** Mirrors lib/line's LINE_IMAGE_CONTENT_TYPES — LINE fetches and accepts only these. */
function isSendable(contentType: string): boolean {
  return contentType === "image/jpeg" || contentType === "image/png";
}
