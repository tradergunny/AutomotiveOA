"use client";

import { Car, Check, Truck } from "lucide-react";
import { createTranslator } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArrivalEcho, ArrivalSubmitError, RecognizedVehicle } from "@/lib/arrivals";
import { formatPhone } from "@/lib/normalize";
import { cn } from "@/lib/utils";
import { recognizeArrival, submitArrival, type SubmitArrivalResult } from "./actions";

/**
 * The customer's form (M7.8 brief §2–§3). One page, two doors:
 *
 * - PLAIN: name, phone, plate, body type, what's wrong, odometer. Nothing
 *   comes back but an echo of what was typed and "please see the front desk".
 * - LINE: when the Shop has a LIFF app, the page initializes LIFF, takes
 *   the ID token, and asks the server what it recognizes. A linked identity
 *   gets its own cars to tap (or "another car"); anything else gets the
 *   plain form. The client never sends a userId — only the token, which the
 *   server verifies (decision 1). LIFF failing to initialize, or the page
 *   opening outside LINE, is the plain door.
 *
 * Always-light and phone-sized (decision 6). Drawn from the /q document's
 * light ground and the app's one accent: sharp geometry, the orange for the
 * one action and the chosen tile, zinc for everything else. Thai first; the
 * toggle is on the page and both message sets ship with it.
 */

type Lang = "th" | "en";
type ArrivalMessages = (typeof import("@/messages/en.json"))["arrivalForm"];

type LineState =
  | { status: "off" }
  | { status: "connecting" }
  | { status: "ready"; idToken: string; displayName: string | null; pictureUrl: string | null }
  | { status: "failed" };

type LiffSdk = {
  init(config: { liffId: string }): Promise<void>;
  isInClient(): boolean;
  isLoggedIn(): boolean;
  login(): void;
  getIDToken(): string | null;
  getDecodedIDToken(): { name?: string; picture?: string } | null;
};

declare global {
  interface Window {
    liff?: LiffSdk;
  }
}

const LIFF_SDK = "https://static.line-scdn.net/liff/edge/2/sdk.js";

const input =
  "h-12 w-full border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/25";
const label = "text-[13px] font-medium text-zinc-700";

export function ArrivalForm({
  token,
  shopName,
  liffId,
  messages,
  devIdentity,
}: {
  token: string;
  shopName: string;
  liffId: string | null;
  messages: Record<Lang, ArrivalMessages>;
  devIdentity: boolean;
}) {
  const [lang, setLang] = useState<Lang>("th");
  const t = useMemo(
    () =>
      createTranslator({
        locale: lang,
        messages: { arrivalForm: messages[lang] },
        namespace: "arrivalForm",
      }),
    [lang, messages],
  );

  const [line, setLine] = useState<LineState>(liffId ? { status: "connecting" } : { status: "off" });
  const [vehicles, setVehicles] = useState<RecognizedVehicle[] | null>(null);
  const [car, setCar] = useState<string | "other" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ArrivalSubmitError | null>(null);
  const [done, setDone] = useState<ArrivalEcho | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Take an ID token (from LIFF or the dev field), ask what it recognizes.
  async function adoptIdentity(idToken: string, profile: { name: string | null; picture: string | null }) {
    const res = await recognizeArrival(token, idToken);
    if (!res.ok) {
      setLine({ status: "failed" });
      setVehicles(null);
      if (res.error === "identityRejected") setError("identityRejected");
      return;
    }
    setError(null);
    setLine({ status: "ready", idToken, displayName: profile.name, pictureUrl: profile.picture });
    setVehicles(res.vehicles);
    setCar(res.vehicles && res.vehicles.length > 0 ? res.vehicles[0].id : res.vehicles ? "other" : null);
  }

  // The LINE door: load the SDK, initialize, and only then decide which
  // form to show. Outside LINE (or on any failure) the plain door opens.
  useEffect(() => {
    if (!liffId) return;
    let cancelled = false;
    const fail = () => !cancelled && setLine({ status: "failed" });

    async function start() {
      const liff = window.liff;
      if (!liff) return fail();
      try {
        await liff.init({ liffId: liffId! });
        if (cancelled) return;
        if (!liff.isLoggedIn()) {
          // Inside LINE this redirects and comes straight back logged in;
          // outside LINE we do not force a login for an arrival notice.
          if (liff.isInClient()) liff.login();
          else setLine({ status: "off" });
          return;
        }
        const idToken = liff.getIDToken();
        if (!idToken) return fail();
        const decoded = liff.getDecodedIDToken();
        await adoptIdentity(idToken, {
          name: decoded?.name ?? null,
          picture: decoded?.picture ?? null,
        });
      } catch {
        fail();
      }
    }

    if (window.liff) {
      void start();
    } else {
      const script = document.createElement("script");
      script.src = LIFF_SDK;
      script.async = true;
      script.onload = () => void start();
      script.onerror = fail;
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per liffId
  }, [liffId]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      formData.set("locale", lang);
      if (line.status === "ready") formData.set("idToken", line.idToken);
      if (vehicles && car && car !== "other") formData.set("vehicleId", car);
      const res: SubmitArrivalResult = await submitArrival(token, formData);
      if (!res.ok) {
        setError(res.error === "notFound" ? "failed" : res.error);
        return;
      }
      setDone(res.echo);
      window.scrollTo({ top: 0 });
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setDone(null);
    setError(null);
    formRef.current?.reset();
    setCar(vehicles && vehicles.length > 0 ? vehicles[0].id : vehicles ? "other" : null);
  }

  const recognized = line.status === "ready" && vehicles !== null;
  const needsCarFields = !recognized || car === "other";
  const needsPerson = !recognized;

  return (
    <div className="mx-auto w-full max-w-md">
      <header className="flex items-center justify-between gap-3">
        <span className="truncate text-[15px] font-semibold tracking-tight">{shopName}</span>
        <div className="flex border border-zinc-300 bg-white" role="group" aria-label="Language">
          {(["th", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={cn(
                "h-8 px-3 font-mono text-[11px] uppercase transition-colors",
                l === lang ? "bg-orange-500 font-bold text-white" : "text-zinc-500 hover:text-zinc-900",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      {done ? (
        <section className="mt-5 border border-zinc-300 bg-white p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 flex-none place-items-center bg-orange-500 text-white">
              <Check className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t("doneTitle")}</h1>
              <p className="mt-0.5 text-sm text-zinc-600">{t("doneLead")}</p>
            </div>
          </div>
          <dl className="mt-5 border-t border-dashed border-zinc-300 pt-4 text-sm">
            <p className="mb-2 text-[12px] text-zinc-500">{t("doneEcho")}</p>
            {done.name && <EchoRow label={t("name")} value={done.name} />}
            {done.phone && <EchoRow label={t("phone")} value={formatPhone(done.phone)} mono />}
            <EchoRow label={t("plate")} value={done.plate} mono />
            {done.bodyType && (
              <EchoRow label={t("bodyType")} value={t(done.bodyType === "PICKUP" ? "pickup" : "sedan")} />
            )}
            <EchoRow label={t("note")} value={done.note} />
            {done.odometerKm != null && (
              <EchoRow label={t("odometer")} value={`${done.odometerKm.toLocaleString()} ${t("km")}`} mono />
            )}
          </dl>
          <button
            type="button"
            onClick={reset}
            className="mt-5 h-11 w-full border border-zinc-300 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-500 active:translate-y-px"
          >
            {t("again")}
          </button>
        </section>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">{t("heading")}</h1>
          <p className="mt-1 text-sm text-zinc-600">{t("lead")}</p>

          {line.status === "connecting" && (
            <p className="mt-4 text-[13px] text-zinc-500">{t("lineConnecting")}</p>
          )}
          {line.status === "ready" && (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-zinc-700">
              {line.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- LINE CDN avatar
                <img src={line.pictureUrl} alt="" className="size-6 border border-zinc-300 object-cover" />
              ) : (
                <span className="inline-block size-2 bg-orange-500" aria-hidden />
              )}
              {line.displayName ? t("lineAs", { name: line.displayName }) : "LINE"}
            </p>
          )}

          <form
            ref={formRef}
            onSubmit={onSubmit}
            className="mt-4 flex flex-col gap-5 border border-zinc-300 bg-white p-4 sm:p-5"
          >
            {recognized && (
              <fieldset className="flex flex-col gap-2">
                <legend className={cn(label, "mb-2")}>
                  {vehicles!.length > 0 ? t("yourCars") : t("plate")}
                </legend>
                {vehicles!.length > 0 && (
                  <p className="-mt-1 mb-1 text-[12px] text-zinc-500">{t("lineRecognized")}</p>
                )}
                {vehicles!.map((vehicle) => (
                  <label
                    key={vehicle.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 border px-3 py-3 transition-colors",
                      car === vehicle.id
                        ? "border-orange-500 bg-orange-50"
                        : "border-zinc-300 hover:border-zinc-500",
                    )}
                  >
                    <input
                      type="radio"
                      name="car"
                      value={vehicle.id}
                      checked={car === vehicle.id}
                      onChange={() => setCar(vehicle.id)}
                      className="sr-only"
                    />
                    {vehicle.bodyType === "PICKUP" ? (
                      <Truck className="size-5 flex-none text-zinc-500" aria-hidden />
                    ) : (
                      <Car className="size-5 flex-none text-zinc-500" aria-hidden />
                    )}
                    <span className="font-mono text-[15px] font-semibold">{vehicle.plate}</span>
                    {vehicle.description && (
                      <span className="truncate text-[13px] text-zinc-500">{vehicle.description}</span>
                    )}
                  </label>
                ))}
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 border border-dashed px-3 py-3 transition-colors",
                    car === "other"
                      ? "border-orange-500 bg-orange-50"
                      : "border-zinc-300 hover:border-zinc-500",
                  )}
                >
                  <input
                    type="radio"
                    name="car"
                    value="other"
                    checked={car === "other"}
                    onChange={() => setCar("other")}
                    className="sr-only"
                  />
                  <span className="text-[15px] font-medium">{t("anotherCar")}</span>
                </label>
              </fieldset>
            )}

            {needsPerson && (
              <>
                <Field id="a-name" label={t("name")}>
                  <input
                    id="a-name"
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    placeholder={t("namePlaceholder")}
                    className={input}
                  />
                </Field>
                <Field id="a-phone" label={t("phone")}>
                  <input
                    id="a-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    required
                    autoComplete="tel"
                    placeholder={t("phonePlaceholder")}
                    className={cn(input, "font-mono")}
                  />
                </Field>
              </>
            )}

            {needsCarFields && (
              <>
                <Field id="a-plate" label={t("plate")}>
                  <input
                    id="a-plate"
                    name="plate"
                    required
                    maxLength={20}
                    autoCapitalize="characters"
                    placeholder={t("platePlaceholder")}
                    className={cn(input, "font-mono")}
                  />
                </Field>
                <fieldset>
                  <legend className={cn(label, "mb-2")}>{t("bodyType")}</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { value: "SEDAN", icon: Car, key: "sedan" },
                        { value: "PICKUP", icon: Truck, key: "pickup" },
                      ] as const
                    ).map(({ value, icon: Icon, key }) => (
                      <label
                        key={value}
                        className="flex h-14 cursor-pointer items-center justify-center gap-2 border border-zinc-300 text-[15px] text-zinc-700 transition-colors hover:border-zinc-500 has-checked:border-orange-500 has-checked:bg-orange-50 has-checked:text-zinc-900"
                      >
                        <input type="radio" name="bodyType" value={value} required className="sr-only" />
                        <Icon className="size-5" aria-hidden />
                        {t(key)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            )}

            <Field id="a-note" label={t("note")}>
              <textarea
                id="a-note"
                name="note"
                required
                rows={3}
                maxLength={1000}
                placeholder={t("notePlaceholder")}
                className={cn(input, "h-auto min-h-24 py-2.5")}
              />
            </Field>

            <Field id="a-odometer" label={t("odometer")} hint={t("optional")}>
              <div className="flex items-center gap-2">
                <input
                  id="a-odometer"
                  name="odometer"
                  inputMode="numeric"
                  maxLength={9}
                  className={cn(input, "max-w-44 font-mono")}
                />
                <span className="text-sm text-zinc-500">{t("km")}</span>
              </div>
            </Field>

            {error && (
              <p role="alert" className="border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {t(`errors.${error}`)}
              </p>
            )}

            <button
              type="submit"
              disabled={pending || line.status === "connecting"}
              className="h-12 w-full bg-orange-500 text-base font-semibold text-white transition-colors hover:bg-orange-600 active:translate-y-px disabled:opacity-60"
            >
              {pending ? t("submitting") : t("submit")}
            </button>
          </form>

          {devIdentity && (
            <DevIdentity
              label={t("devIdentity")}
              hint={t("devIdentityHint")}
              apply={t("devApply")}
              onApply={(idToken) => adoptIdentity(idToken, { name: null, picture: null })}
            />
          )}
        </>
      )}
    </div>
  );
}

function Field({
  id,
  label: text,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={cn(label, "flex items-baseline gap-2")}>
        {text}
        {hint && <span className="text-[12px] font-normal text-zinc-400">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function EchoRow({ label: text, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-1">
      <dt className="w-24 flex-none text-zinc-500">{text}</dt>
      <dd className={cn("min-w-0 flex-1 break-words", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

/** Development only (decision 4): the LINE door without a LINE Login channel. */
function DevIdentity({
  label: text,
  hint,
  apply,
  onApply,
}: {
  label: string;
  hint: string;
  apply: string;
  onApply: (idToken: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  return (
    <details className="mt-4 border border-dashed border-zinc-400 px-3 py-2 text-[12px] text-zinc-600">
      <summary className="cursor-pointer font-mono">{text}</summary>
      <div className="mt-2 flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="dev:U0000000000000000000000000000000a"
          className="h-9 w-full border border-zinc-300 bg-white px-2 font-mono text-[12px]"
        />
        <button
          type="button"
          onClick={() => void onApply(value.trim())}
          className="h-9 flex-none border border-zinc-400 px-3 font-medium hover:border-zinc-700"
        >
          {apply}
        </button>
      </div>
      <p className="mt-1 text-zinc-400">{hint}</p>
    </details>
  );
}
