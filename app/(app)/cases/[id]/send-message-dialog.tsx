"use client";

import { ImageOff, PhoneOutgoing, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ComposerFollowUp, ComposerPhoto, SendBlockedReason } from "./customer-timeline";
import { sendLineUpdate, type SendUpdateError, type SentUpdateDto } from "./line-actions";

/**
 * Send a message (D-29): the free-form LINE Update, for Follow-ups and the
 * ad-hoc word, in the Send quotation shape (D-25) — the recipient in the
 * title, the Thai text seeded by the draft, photo picks, one Send. The
 * preview and the arm-then-confirm double press retired with the composer;
 * a fixed, named recipient in the title is the safeguard. When the LINE gate
 * blocks, the dialog says why and Send stays off.
 *
 * SendMessageForm is the dialog's body without the Radix shell, so it can be
 * rendered on its own (tests).
 */

export function SendMessageDialog(props: SendMessageFormProps) {
  const t = useTranslations("customerTimeline");
  return (
    <DialogContent
      width="md"
      title={t("dialog.title", { name: props.recipientName })}
      description={t("dialog.description")}
    >
      <SendMessageForm {...props} />
    </DialogContent>
  );
}

export type SendMessageFormProps = {
  caseId: string;
  recipientName: string;
  /** The Thai seed: the draft for this case, or the Follow-up chase. */
  initialBody: string;
  photos: ComposerPhoto[];
  blockedReason: SendBlockedReason;
  maxPhotos: number;
  followUp: ComposerFollowUp | null;
  onSent: (update: SentUpdateDto) => void;
  onClose: () => void;
};

export function SendMessageForm({
  caseId,
  initialBody,
  photos,
  blockedReason,
  maxPhotos,
  followUp,
  onSent,
  onClose,
}: SendMessageFormProps) {
  const t = useTranslations("customerTimeline");
  const tc = useTranslations("common");
  const [body, setBody] = useState(initialBody);
  const [selected, setSelected] = useState<string[]>([]);
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
      onSent(res.value);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogBody>
        {followUp && (
          <p className="flex items-center gap-2 rounded-[10px] border border-primary-dim bg-primary-soft/40 px-2.5 py-1.5 text-[11.5px] text-primary">
            <PhoneOutgoing className="size-3.5 flex-none" aria-hidden />
            {t("dialog.followupContext", { label: followUp.label })}
          </p>
        )}

        {blockedReason && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-[10px] border border-warn/45 bg-warn/10 px-2.5 py-2 text-[11.5px] text-warn"
          >
            <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden />
            {t(`blocked.${blockedReason}`)}
          </p>
        )}

        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={8}
          spellCheck={false}
          aria-label={t("dialog.bodyLabel")}
          className="w-full resize-y rounded-[10px] border bg-background px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-primary"
        />
        <p className="text-[10.5px] text-faint">{t("dialog.draftHint")}</p>

        {sendable.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="num text-[11px] text-faint">
              {t("dialog.photosTitle", { selected: selected.length, max: maxPhotos })}
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
                    aria-pressed={chosen}
                    className={cn(
                      "relative size-16 overflow-hidden rounded-[10px] border",
                      chosen ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-border-strong",
                      !chosen && capReached && "opacity-40",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- bytes come from our authenticated route; next/image would re-fetch without the session cookie */}
                    <img src={`/api/photos/${photo.id}`} alt="" loading="lazy" className="size-full object-cover" />
                    {chosen && (
                      <span className="num absolute right-1 top-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
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
                {t("dialog.photosRejected", { count: rejected })}
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-[10px] border border-bad/45 bg-bad/10 px-2.5 py-1.5 text-[11px] text-bad">
            {t(`errors.${error}`)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          size="sm"
          disabled={pending || !!blockedReason || !body.trim()}
          className="h-8 rounded-full font-semibold"
          onClick={() => void send()}
        >
          <Send data-icon="inline-start" />
          {pending ? t("dialog.sending") : t("dialog.send")}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-8 rounded-full" onClick={onClose}>
          {tc("cancel")}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Mirrors lib/line's LINE_IMAGE_CONTENT_TYPES — LINE fetches and accepts only these. */
function isSendable(contentType: string): boolean {
  return contentType === "image/jpeg" || contentType === "image/png";
}
