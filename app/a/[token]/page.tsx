import type { Metadata } from "next";
import { notFound } from "next/navigation";
import en from "@/messages/en.json";
import th from "@/messages/th.json";
import { resolveArrivalShop } from "@/lib/line-public";
import { ArrivalForm } from "./arrival-form";

/**
 * The public Arrival form (M7.8 brief §2–§3, ADR-006): the page a customer
 * opens from the counter's QR or from the Shop's LINE account to say "I am
 * here, with this car, and this is what's wrong". Unauthenticated (the proxy
 * excludes /a/*), never indexed, and an unknown or rotated token is a plain
 * 404 — the /q document's terms. Always-light (decision 6): inside LINE's
 * in-app browser this IS the page, and the dark app chrome never appears to
 * a customer. Thai-first with an English toggle that lives on the page, not
 * in the staff locale cookie: both languages ship to the client and the
 * customer picks.
 *
 * Write-only: the page prints the Shop's name and nothing else about it,
 * and never answers whether a phone or plate is known.
 */

export const metadata: Metadata = {
  title: "แจ้งรับรถ",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ArrivalPage({ params }: PageProps<"/a/[token]">) {
  const { token } = await params;
  const shop = await resolveArrivalShop(token);
  if (!shop) notFound();

  return (
    <main className="min-h-dvh bg-zinc-100 px-4 py-5 text-zinc-900 sm:py-10">
      <ArrivalForm
        token={token}
        shopName={shop.shopName}
        liffId={shop.liffId}
        messages={{ th: th.arrivalForm, en: en.arrivalForm }}
        // The dev identity field (decision 4): the LINE door, walkable with
        // no LINE Login channel. Never rendered outside development.
        devIdentity={process.env.NODE_ENV === "development"}
      />
    </main>
  );
}
