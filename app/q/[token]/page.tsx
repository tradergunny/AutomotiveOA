import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuotationDocument } from "@/components/blocks/quotation-document";
import { quotationLabel } from "@/lib/jobs";
import { resolvePublishedQuotation } from "@/lib/line-public";

/**
 * The published quotation (M7.7 brief §6, D-25): the always-light document a
 * customer opens from the LINE message, reachable by nothing but the
 * unguessable token minted when a human pressed Send. Unauthenticated (the
 * proxy excludes /q/*), never indexed, and a wrong or revoked token is a
 * plain 404 — the published-photo route's terms, applied to the document.
 * Nothing about the case, the customer or the shop is exposed by holding a
 * token beyond what the document itself prints.
 */

export const metadata: Metadata = {
  title: "ใบเสนอราคา",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PublishedQuotationPage({ params }: PageProps<"/q/[token]">) {
  const { token } = await params;
  const quotation = await resolvePublishedQuotation(token);
  if (!quotation) notFound();

  const { repairCase, lines } = quotation;
  const { vehicle, contactCustomer } = repairCase;

  return (
    // The dark app chrome never appears here: a light ground, the document,
    // nothing else — inside LINE's in-app browser this IS the page.
    <main className="min-h-dvh bg-zinc-100 px-3 py-4 text-zinc-900 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <QuotationDocument
          shopName={repairCase.shop.name}
          label={quotationLabel(quotation.number, quotation.version)}
          issuedAt={quotation.issuedAt}
          issuedByName={quotation.issuedBy.name}
          reference={repairCase.reference}
          plate={vehicle.plate}
          province={vehicle.province}
          vehicleDescriptors={[vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ")}
          customerName={contactCustomer.name}
          customerPhone={contactCustomer.phone}
          lines={lines}
          totalSatang={quotation.totalSatang}
        />
      </div>
    </main>
  );
}
