"use client";

import { Check, Copy, KeyRound, Printer, QrCode, RefreshCw, Smartphone } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { encodeQr, qrPath } from "@/lib/qr";
import { cn } from "@/lib/utils";
import {
  disableArrivalForm,
  enableArrivalForm,
  rotateArrivalLink,
  saveLiffSettings,
  type ArrivalFormDto,
  type ArrivalSettingsError,
  type LiffDto,
} from "./arrival-actions";

/**
 * The Arrivals panel (M7.8 brief §8), in the LINE panel's shape: one card
 * for the public form (enable → URL + QR, rotate, disable) and one for the
 * LINE door (LIFF ID, Login channel ID, the endpoint URL to paste, and the
 * short checklist mirroring LINE-SETUP Part 6). Manager-only to change;
 * Advisors read.
 */

const LIFF_CHECKLIST = ["provider", "liffApp", "copyIds", "richMenu"] as const;

export function ArrivalSettings({
  initialForm,
  initialLiff,
  origin,
  channelConnected,
  canManage,
}: {
  initialForm: ArrivalFormDto;
  initialLiff: LiffDto | null;
  origin: string;
  channelConnected: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("arrivalSettings");
  const tc = useTranslations("common");
  const format = useFormatter();

  const [form, setForm] = useState(initialForm);
  const [liff, setLiff] = useState<LiffDto>(initialLiff ?? { liffId: null, loginChannelId: null });
  const [error, setError] = useState<{ area: "form" | "liff"; code: ArrivalSettingsError } | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [armed, setArmed] = useState<"rotate" | "disable" | null>(null);

  const url = form.token ? `${origin}/a/${form.token}` : null;
  const qr = useMemo(() => (url ? encodeQr(url) : null), [url]);

  async function run<T>(
    area: "form" | "liff",
    action: () => Promise<{ ok: true; value: T } | { ok: false; error: ArrivalSettingsError }>,
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

  function arm(kind: "rotate" | "disable", go: () => void) {
    if (armed !== kind) {
      setArmed(kind);
      setTimeout(() => setArmed((current) => (current === kind ? null : current)), 4000);
      return;
    }
    setArmed(null);
    go();
  }

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* The public form and its rotatable key                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative border bg-card">
        <CornerTicks />
        <header className="flex flex-wrap items-center gap-2.5 border-b border-dashed px-3.5 py-2.5">
          <QrCode className="size-4 text-primary" aria-hidden />
          <h2 className="text-[12.5px] font-semibold tracking-wide">{t("title")}</h2>
          {form.token && (
            <span className="ml-auto flex items-center gap-1 border border-ok/45 px-1.5 py-px text-[10.5px] text-ok">
              <Check className="size-3" aria-hidden />
              {t("enabled")}
            </span>
          )}
        </header>

        <div className="flex flex-col gap-3 px-3.5 py-3">
          <p className="text-[11.5px] text-muted-foreground">{t("intro")}</p>

          {url && qr ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <svg
                viewBox={`-2 -2 ${qr.length + 4} ${qr.length + 4}`}
                className="size-36 flex-none border bg-white p-1"
                role="img"
                aria-label={t("urlTitle")}
                shapeRendering="crispEdges"
              >
                <path d={qrPath(qr)} fill="#09090b" />
              </svg>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="eyebrow">{t("urlTitle")}</span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate border bg-surface-2 px-2 py-1 font-mono text-[11px]">
                    {url}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex flex-none items-center gap-1 border border-border-strong px-2 py-1 text-[11px] text-muted-foreground hover:border-primary-dim hover:text-primary"
                  >
                    {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                    {copied ? t("copied") : tc("copy")}
                  </button>
                </div>
                <p className="text-[11px] text-faint">{t("qrHint")}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Link
                    href="/settings/arrival-poster"
                    className="flex items-center gap-1.5 border border-primary-dim px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                  >
                    <Printer className="size-3.5" aria-hidden />
                    {t("printQr")}
                  </Link>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          arm("rotate", () =>
                            void run("form", rotateArrivalLink).then((v) => v && setForm(v)),
                          )
                        }
                        className={cn(
                          "flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold",
                          armed === "rotate"
                            ? "border-warn/60 bg-warn/15 text-warn"
                            : "border-border-strong text-muted-foreground hover:border-warn/50 hover:text-warn",
                        )}
                      >
                        <RefreshCw className="size-3.5" aria-hidden />
                        {armed === "rotate" ? t("rotateConfirm") : t("rotate")}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          arm("disable", () =>
                            void run("form", disableArrivalForm).then((v) => v && setForm(v)),
                          )
                        }
                        className={cn(
                          "flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold",
                          armed === "disable"
                            ? "border-bad/60 bg-bad/15 text-bad"
                            : "border-border-strong text-muted-foreground hover:border-bad/50 hover:text-bad",
                        )}
                      >
                        <KeyRound className="size-3.5" aria-hidden />
                        {armed === "disable" ? t("disableConfirm") : t("disable")}
                      </button>
                    </>
                  )}
                </div>
                {form.rotatedAt && (
                  <p className="num text-[11px] text-faint">
                    {t("rotatedAt", {
                      when: format.dateTime(new Date(form.rotatedAt), {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })}
                  </p>
                )}
              </div>
            </div>
          ) : canManage ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                disabled={pending}
                onClick={() => void run("form", enableArrivalForm).then((v) => v && setForm(v))}
                className="w-fit"
              >
                {pending ? t("enabling") : t("enable")}
              </Button>
              <span className="text-xs text-faint">{t("disabledState")}</span>
            </div>
          ) : (
            <p className="text-xs text-faint">{t("disabledReadOnly")}</p>
          )}

          {error?.area === "form" && <ErrorLine code={error.code} />}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The LINE door                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative border bg-card">
        <CornerTicks />
        <header className="flex flex-wrap items-center gap-2.5 border-b border-dashed px-3.5 py-2.5">
          <Smartphone className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-[12.5px] font-semibold tracking-wide">{t("liffTitle")}</h2>
          <span
            className={cn(
              "ml-auto border px-1.5 py-px text-[10.5px]",
              liff.liffId ? "border-ok/45 text-ok" : "border-border-strong text-faint",
            )}
          >
            {liff.liffId ? t("liffOn") : t("liffOff")}
          </span>
        </header>

        <div className="flex flex-col gap-3 px-3.5 py-3">
          <p className="text-[11.5px] text-muted-foreground">{t("liffIntro")}</p>

          {!channelConnected ? (
            <p className="text-xs text-faint">{t("liffNeedsChannel")}</p>
          ) : !url ? (
            <p className="text-xs text-faint">{t("liffNeedsForm")}</p>
          ) : (
            <>
              <div className="border border-dashed px-2.5 py-2">
                <span className="eyebrow">{t("liffEndpoint")}</span>
                <code className="mt-1 block truncate border bg-surface-2 px-2 py-1 font-mono text-[11px]">
                  {url}
                </code>
                <p className="mt-1 text-[11px] text-faint">{t("liffEndpointHint")}</p>
              </div>

              <form
                action={(formData) =>
                  void run("liff", () => saveLiffSettings(formData)).then((v) => {
                    if (!v) return;
                    setLiff(v);
                    setSaved(true);
                    setTimeout(() => setSaved(false), 2000);
                  })
                }
                className="grid gap-2.5 sm:grid-cols-2"
              >
                <label className="flex flex-col gap-1">
                  <span className="eyebrow">{t("liffId")}</span>
                  <Input
                    name="liffId"
                    defaultValue={liff.liffId ?? ""}
                    placeholder="1234567890-AbCdEfGh"
                    autoComplete="off"
                    spellCheck={false}
                    readOnly={!canManage}
                    className="font-mono text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="eyebrow">{t("loginChannelId")}</span>
                  <Input
                    name="loginChannelId"
                    defaultValue={liff.loginChannelId ?? ""}
                    placeholder="1234567890"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    readOnly={!canManage}
                    className="font-mono text-xs"
                  />
                </label>
                {canManage && (
                  <div className="flex items-center gap-2 sm:col-span-2">
                    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
                      {saved ? <Check className="size-3.5" aria-hidden /> : null}
                      {saved ? t("liffSaved") : t("liffSave")}
                    </Button>
                  </div>
                )}
              </form>

              <ol className="flex flex-col gap-1 border-t border-dashed pt-2.5">
                {LIFF_CHECKLIST.map((step, index) => (
                  <li key={step} className="flex gap-1.5 text-[11px] text-muted-foreground">
                    <span className="num flex-none text-faint">{index + 1}.</span>
                    {t(`checklist.${step}`)}
                  </li>
                ))}
              </ol>
            </>
          )}

          {error?.area === "liff" && <ErrorLine code={error.code} />}
        </div>
      </section>
    </>
  );
}

function ErrorLine({ code }: { code: ArrivalSettingsError }) {
  const t = useTranslations("arrivalSettings");
  return (
    <p role="alert" className="border border-bad/45 px-2.5 py-1.5 text-[11.5px] text-bad">
      {t(`errors.${code}`)}
    </p>
  );
}
