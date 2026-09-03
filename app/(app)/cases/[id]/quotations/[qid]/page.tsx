import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { PrintButton } from "@/components/blocks/print-button";
import { QuotationDocument } from "@/components/blocks/quotation-document";
import { quotationLabel } from "@/lib/jobs";
import { tenantDb } from "@/lib/session";

// Quotation document view (M4 brief §6, DESIGN.md D-1): the one always-light
// artifact in a dark-only app, wrapped in the staff chrome. Printing uses the
// browser (print / save as PDF) via the .q-doc print CSS — the chrome
// disappears, the document remains. Since M7.7 (D-25) a sent version also
// carries its customer link, the same document at /q/[token].
export default async function QuotationPage({
  params,
}: PageProps<"/cases/[id]/quotations/[qid]">) {
  const { id, qid } = await params;
  const [tq, format, db] = await Promise.all([
    getTranslations("quotations"),
    getFormatter(),
    tenantDb(),
  ]);

  const quotation = await db.quotation.findUnique({
    where: { id: qid },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      issuedBy: { select: { name: true } },
      repairCase: {
        include: {
          vehicle: true,
          contactCustomer: true,
          shop: { select: { name: true } },
        },
      },
    },
  });
  if (!quotation || quotation.caseId !== id) notFound();

  const { repairCase, lines } = quotation;
  const { vehicle, contactCustomer } = repairCase;
  const label = quotationLabel(quotation.number, quotation.version);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* dark chrome — hidden in print */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/cases/${repairCase.id}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {tq("backToCase")}
        </Link>
        <span className="font-mono text-lg font-semibold text-primary">{label}</span>
        <span className="num text-xs text-muted-foreground">
          {format.dateTime(quotation.issuedAt, {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · {quotation.issuedBy.name}
        </span>
        {quotation.publicToken ? (
          <Link
            href={`/q/${quotation.publicToken}`}
            target="_blank"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {tq("customerLink")}
          </Link>
        ) : (
          <span className="text-xs text-faint">{tq("notSentYet")}</span>
        )}
        <span className="ml-auto">
          <PrintButton />
        </span>
      </div>

      <QuotationDocument
        shopName={repairCase.shop.name}
        label={label}
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
  );
}
