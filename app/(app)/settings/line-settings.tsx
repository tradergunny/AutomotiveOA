"use client";

import {
  BadgeCheck,
  Check,
  Copy,
  Link2,
  Link2Off,
  MessageCircle,
  Plug,
  RefreshCw,
  Search,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/normalize";
import { cn } from "@/lib/utils";
import {
  captureLineUserId,
  connectLineChannel,
  disconnectLineChannel,
  linkLineContact,
  lookupCustomerForLink,
  unlinkLineContact,
  verifyLineChannel,
  type LineChannelDto,
  type LineSettingsError,
} from "./actions";
import type { LineContactDto } from "./contact-dto";

/**
 * The "connect your LINE OA" screen (ADR-002's onboarding step) plus the
 * contacts inbox that makes pushing possible at all (ADR-005).
 *
 * Credentials are write-only from here: they are typed once, verified against
 * LINE, sealed server-side, and never read back — the connected state renders
 * a fingerprint and the OA's own public identity instead.
 */

const CHECKLIST_STEPS = ["webhookUrl", "useWebhook", "autoReply"] as const;

export function LineSettings({
  initialChannel,
  initialContacts,
  webhookUrl,
  canManage,
  cryptoAvailable,
  transportMode,
}: {
  initialChannel: LineChannelDto | null;
  initialContacts: LineContactDto[];
  webhookUrl: string;
  canManage: boolean;
  cryptoAvailable: boolean;
  transportMode: "live" | "fake";
}) {
  const t = useTranslations("lineSettings");
  const tc = useTranslations("common");
  const format = useFormatter();

  const [channel, setChannel] = useState(initialChannel);
  const [contacts, setContacts] = useState(initialContacts);
  // Errors render where the action was taken, not in one far-away place —
  // the channel form and the contacts inbox are a screen apart.
  const [error, setError] = useState<{ area: "channel" | "contacts"; code: LineSettingsError } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [armedDisconnect, setArmedDisconnect] = useState(false);
  const connectFormRef = useRef<HTMLFormElement>(null);
  const captureFormRef = useRef<HTMLFormElement>(null);

  async function run<T>(
    area: "channel" | "contacts",
    action: () => Promise<{ ok: true; value: T } | { ok: false; error: LineSettingsError }>,
  ) {
    if (pending) return null;
    setPending(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError({ area, code: res.error });
        return null;
      }
      return res.value;
    } finally {
      setPending(false);
    }
  }

  const linked = contacts.filter((c) => c.customer);
  const unlinked = contacts.filter((c) => !c.customer);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* ---------------------------------------------------------------- */}
      {/* The channel (ADR-002)                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative border bg-card">
        <CornerTicks />
        <header className="flex flex-wrap items-center gap-2.5 border-b border-dashed px-3.5 py-2.5">
          <MessageCircle className="size-4 text-primary" aria-hidden />
          <h2 className="text-[12.5px] font-semibold tracking-wide">{t("channelTitle")}</h2>
          {transportMode === "fake" && (
            <span className="border border-dashed border-border-strong px-1.5 py-px font-mono text-[9px] tracking-wider text-faint">
              {t("fakeTransport")}
            </span>
          )}
          {channel && (
            <span className="ml-auto flex items-center gap-1 border border-ok/45 px-1.5 py-px text-[10.5px] text-ok">
              <BadgeCheck className="size-3" aria-hidden />
              {t("connected")}
            </span>
          )}
        </header>

        <div className="flex flex-col gap-3 px-3.5 py-3">
          {!cryptoAvailable && (
            <p
              role="alert"
              className="flex items-start gap-2 border border-warn/45 px-2.5 py-2 text-[11.5px] text-warn"
            >
              <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden />
              {t("keyMissing")}
            </p>
          )}

          {channel ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={t("oaName")} value={channel.botDisplayName ?? "—"} />
                <Field label={t("oaBasicId")} value={channel.botBasicId ?? "—"} mono />
                <Field label={t("channelSecret")} value={channel.secretFingerprint} mono />
                <Field label={t("accessToken")} value={channel.tokenFingerprint} mono />
                <Field
                  label={t("verifiedAt")}
                  value={
                    channel.verifiedAt
                      ? format.dateTime(new Date(channel.verifiedAt), {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"
                  }
                />
                <Field label={t("connectedBy")} value={channel.connectedByName} />
              </div>

              {canManage && (
                <div className="flex flex-wrap items-center gap-2 border-t border-dashed pt-3">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run("channel", verifyLineChannel).then((v) => v && setChannel(v))
                    }
                    className="flex items-center gap-1.5 border border-border-strong px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:border-primary-dim hover:text-primary"
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    {t("reverify")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!armedDisconnect) {
                        setArmedDisconnect(true);
                        setTimeout(() => setArmedDisconnect(false), 4000);
                        return;
                      }
                      setArmedDisconnect(false);
                      void run("channel", disconnectLineChannel).then((v) => v !== null && setChannel(null));
                    }}
                    className={cn(
                      "flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold",
                      armedDisconnect
                        ? "border-bad/60 bg-bad/15 text-bad"
                        : "border-border-strong text-muted-foreground hover:border-bad/50 hover:text-bad",
                    )}
                  >
                    <Plug className="size-3.5" aria-hidden />
                    {armedDisconnect ? t("disconnectConfirm") : t("disconnect")}
                  </button>
                  <span className="text-[11px] text-faint">{t("disconnectHint")}</span>
                </div>
              )}
            </>
          ) : canManage ? (
            <form
              ref={connectFormRef}
              action={(formData) =>
                void run("channel", () => connectLineChannel(formData)).then((v) => {
                  if (!v) return;
                  setChannel(v);
                  connectFormRef.current?.reset();
                })
              }
              className="flex flex-col gap-2.5"
            >
              <p className="text-[11.5px] text-muted-foreground">{t("connectIntro")}</p>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">{t("channelSecret")}</span>
                <Input name="channelSecret" required autoComplete="off" spellCheck={false} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">{t("accessToken")}</span>
                <Input name="channelAccessToken" required autoComplete="off" spellCheck={false} />
              </label>
              <Button type="submit" disabled={pending || !cryptoAvailable} className="w-fit">
                {pending ? t("verifying") : t("connect")}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-faint">{t("notConnectedReadOnly")}</p>
          )}

          {error?.area === "channel" && <ErrorLine code={error.code} />}

          {/* The webhook URL — ADR-005's onboarding friction, made copyable. */}
          <div className="border border-dashed px-2.5 py-2">
            <span className="eyebrow">{t("webhookTitle")}</span>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate border bg-surface-2 px-2 py-1 font-mono text-[11px]">
                {webhookUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(webhookUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex flex-none items-center gap-1 border border-border-strong px-2 py-1 text-[11px] text-muted-foreground hover:border-primary-dim hover:text-primary"
              >
                {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                {copied ? t("copied") : tc("copy")}
              </button>
            </div>
            <ol className="mt-2 flex flex-col gap-1">
              {CHECKLIST_STEPS.map((step, index) => (
                <li key={step} className="flex gap-1.5 text-[11px] text-muted-foreground">
                  <span className="num flex-none text-faint">{index + 1}.</span>
                  {t(`checklist.${step}`)}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The contacts inbox (ADR-005)                                     */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative border bg-card">
        <CornerTicks />
        <header className="flex items-center gap-2.5 border-b border-dashed px-3.5 py-2.5">
          <Link2 className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-[12.5px] font-semibold tracking-wide">{t("contactsTitle")}</h2>
          <span className="num ml-auto border border-border-strong px-1.5 text-[10.5px] text-primary">
            {unlinked.length}
          </span>
        </header>

        <p className="border-b border-dashed px-3.5 py-2 text-[11.5px] text-muted-foreground">
          {t("contactsIntro")}
        </p>

        {unlinked.length === 0 ? (
          <p className="px-3.5 py-3 text-xs text-faint">{t("noUnlinked")}</p>
        ) : (
          <ul>
            {unlinked.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                pending={pending}
                onLink={async (customerId) => {
                  const updated = await run("contacts", () => linkLineContact(contact.id, customerId));
                  if (updated) {
                    setContacts((list) =>
                      list.map((c) => (c.id === updated.id ? updated : c)),
                    );
                  }
                }}
              />
            ))}
          </ul>
        )}

        {linked.length > 0 && (
          <>
            <header className="flex items-center gap-2 border-y border-dashed bg-surface-2/40 px-3.5 py-1.5">
              <span className="eyebrow">{t("linkedTitle")}</span>
              <span className="num ml-auto text-[10.5px] text-faint">{linked.length}</span>
            </header>
            <ul>
              {linked.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-center gap-2 border-b border-dashed px-3.5 py-2 text-xs last:border-0"
                >
                  <ContactIdentity contact={contact} />
                  <span className="flex items-center gap-1.5">
                    <Link2 className="size-3 text-ok" aria-hidden />
                    <span className="font-medium">{contact.customer!.name}</span>
                    <span className="num text-[11px] text-muted-foreground">
                      {formatPhone(contact.customer!.phone)}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void run("contacts", () => unlinkLineContact(contact.id)).then((updated) => {
                        if (updated) {
                          setContacts((list) =>
                            list.map((c) => (c.id === updated.id ? updated : c)),
                          );
                        }
                      })
                    }
                    className="ml-auto flex items-center gap-1 border border-border-strong px-2 py-0.5 text-[11px] text-muted-foreground hover:border-bad/50 hover:text-bad"
                  >
                    <Link2Off className="size-3" aria-hidden />
                    {t("unlink")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {error?.area === "contacts" && (
          <div className="border-t border-dashed px-3.5 py-2.5">
            <ErrorLine code={error.code} />
          </div>
        )}

        {canManage && (
          <form
            ref={captureFormRef}
            action={(formData) =>
              void run("contacts", () => captureLineUserId(formData)).then((created) => {
                if (!created) return;
                setContacts((list) => [created, ...list]);
                captureFormRef.current?.reset();
              })
            }
            className="flex flex-wrap items-end gap-2 border-t border-dashed px-3.5 py-3"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="eyebrow">{t("captureTitle")}</span>
              <Input
                name="lineUserId"
                placeholder={t("capturePlaceholder")}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
            </label>
            <Button type="submit" variant="outline" disabled={pending} className="flex-none">
              <UserPlus className="size-3.5" aria-hidden />
              {t("capture")}
            </Button>
            <p className="w-full text-[11px] text-faint">{t("captureHint")}</p>
          </form>
        )}
      </section>

    </div>
  );
}

function ErrorLine({ code }: { code: LineSettingsError }) {
  const t = useTranslations("lineSettings");
  return (
    <p role="alert" className="border border-bad/45 px-2.5 py-1.5 text-[11.5px] text-bad">
      {t(`errors.${code}`)}
    </p>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-dashed px-2.5 py-1.5">
      <span className="eyebrow">{label}</span>
      <p className={cn("mt-0.5 truncate text-[13px]", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}

function ContactIdentity({ contact }: { contact: LineContactDto }) {
  const t = useTranslations("lineSettings");
  return (
    <span className="flex min-w-0 items-center gap-2">
      {contact.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- LINE CDN avatar, shown so staff can recognize the person before linking
        <img
          src={contact.pictureUrl}
          alt=""
          className="size-6 flex-none border object-cover"
          loading="lazy"
        />
      ) : (
        <span className="grid size-6 flex-none place-items-center border border-border-strong text-[10px] text-faint">
          ?
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium">{contact.displayName ?? t("noName")}</span>
        <span className="block truncate font-mono text-[10px] text-faint">
          {contact.lineUserId}
        </span>
      </span>
      {contact.followState === "UNFOLLOWED" && (
        <span className="flex-none border border-warn/45 px-1 py-px text-[10px] text-warn">
          {t("unfollowed")}
        </span>
      )}
    </span>
  );
}

/** One unlinked identity, with the phone lookup that matches it to a person. */
function ContactRow({
  contact,
  pending,
  onLink,
}: {
  contact: LineContactDto;
  pending: boolean;
  onLink: (customerId: string) => Promise<void>;
}) {
  const t = useTranslations("lineSettings");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [searched, setSearched] = useState(false);

  async function search() {
    setLooking(true);
    setSearched(false);
    try {
      const res = await lookupCustomerForLink(phone);
      setFound(res.ok ? res.value : null);
      setSearched(true);
    } finally {
      setLooking(false);
    }
  }

  return (
    <li className="border-b border-dashed px-3.5 py-2 text-xs last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <ContactIdentity contact={contact} />
        <span className="num ml-auto text-[10.5px] text-faint">
          {format.relativeTime(new Date(contact.firstSeenAt))}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-none items-center gap-1 border border-primary-dim px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary-soft"
        >
          <Link2 className="size-3" aria-hidden />
          {t("link")}
        </button>
      </div>

      {open && (
        <div className="mt-2 flex flex-col gap-2 border-l border-dashed pl-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("phonePlaceholder")}
              inputMode="tel"
              className="num w-44 flex-none"
            />
            <button
              type="button"
              disabled={looking}
              onClick={() => void search()}
              className="flex items-center gap-1 border border-border-strong px-2 py-1 text-[11px] text-muted-foreground hover:border-primary-dim hover:text-primary"
            >
              <Search className="size-3" aria-hidden />
              {looking ? t("searching") : t("search")}
            </button>
          </div>

          {searched && !found && <p className="text-[11px] text-faint">{t("noCustomer")}</p>}

          {found && (
            <div className="flex flex-wrap items-center gap-2 border px-2.5 py-1.5">
              <span className="font-medium">{found.name}</span>
              <span className="num text-[11px] text-muted-foreground">
                {formatPhone(found.phone)}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void onLink(found.id).then(() => {
                    setOpen(false);
                    setFound(null);
                    setPhone("");
                    setSearched(false);
                  })
                }
                className="ml-auto flex items-center gap-1 border border-ok/50 px-2 py-0.5 text-[11px] font-semibold text-ok hover:bg-ok/10"
              >
                <Check className="size-3" aria-hidden />
                {t("confirmLink")}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
