import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PrintButton } from "@/components/blocks/print-button";
import { encodeQr, qrPath } from "@/lib/qr";
import { requireSession, tenantDb } from "@/lib/session";

/**
 * The counter poster (M7.8 brief §8): the Shop's Arrival QR, printed from
 * the browser like the quotation document — the `q-doc` class is what the
 * print stylesheet keeps. Thai first, one line of English, the shop's name,
 * nothing else. A shop with the form disabled has no poster.
 */
export default async function ArrivalPosterPage() {
  const [session, db, headerList, t, tc] = await Promise.all([
    requireSession(),
    tenantDb(),
    headers(),
    getTranslations("arrivalSettings"),
    getTranslations("common"),
  ]);
  const shop = await db.shop.findUniqueOrThrow({
    where: { id: session.shopId },
    select: { name: true, arrivalToken: true },
  });
  if (!shop.arrivalToken) notFound();

  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("host") ?? "localhost:3000";
  const url = `${proto}://${host}/a/${shop.arrivalToken}`;
  const qr = encodeQr(url);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link
          href="/settings"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {tc("back")}
        </Link>
        <PrintButton />
      </div>

      <section className="q-doc flex flex-col items-center gap-6 border bg-white px-8 py-10 text-center text-zinc-900">
        <h1 className="text-3xl font-semibold tracking-tight">แจ้งรับรถ</h1>
        <p className="-mt-4 text-base text-zinc-600">สแกนเพื่อแจ้งว่ามาถึงแล้ว · Scan to check in</p>
        <svg
          viewBox={`-2 -2 ${qr.length + 4} ${qr.length + 4}`}
          className="size-64"
          role="img"
          aria-label={t("urlTitle")}
          shapeRendering="crispEdges"
        >
          <path d={qrPath(qr)} fill="#09090b" />
        </svg>
        <p className="text-lg font-semibold">{shop.name}</p>
      </section>
    </div>
  );
}
