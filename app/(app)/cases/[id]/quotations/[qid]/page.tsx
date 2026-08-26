import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createTranslator } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { PrintButton } from "@/components/blocks/print-button";
import { quotationLabel } from "@/lib/jobs";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";
import thMessages from "@/messages/th.json";

// Quotation document view (M4 brief §6, DESIGN.md D-1): the one always-light
// artifact in a dark-only app. The document itself is Thai-first (founder
// ruling — customer-facing, like LINE templates) regardless of the staff UI
// locale; only the surrounding chrome follows the session locale. Printing
// uses the browser (print / save as PDF) via the .q-doc print CSS — the
// chrome disappears, the document remains. Quotations are immutable: this
// page renders the snapshot rows, never the live Jobs.
export default async function QuotationPage({
  params,
}: PageProps<"/cases/[id]/quotations/[qid]">) {
  const { id, qid } = await params;
  const [tq, format, db] = await Promise.all([
    getTranslations("quotations"),
    getFormatter(),
    tenantDb(),
  ]);
  // The document's own copy is ALWAYS Thai, whatever the staff locale
  // (founder ruling) — so it translates straight from the Thai messages,
  // bypassing the cookie-locale request config on purpose.
  const td = createTranslator({
    locale: "th",
    messages: thMessages,
    namespace: "quotationDoc",
  });

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
  const descriptors = [vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ");

  // Thai business-document formats: Buddhist-era date, bare amounts with a
  // บาท column header (two decimals, no ฿ per cell).
  const thaiDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(quotation.issuedAt);
  const amount = (satang: number) =>
    new Intl.NumberFormat("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(satang / 100);

  const meta: [string, string][] = [
    [td("number"), label],
    [td("date"), thaiDate],
    [td("caseRef"), repairCase.reference],
    [td("plate"), `${vehicle.plate}${vehicle.province ? ` ${vehicle.province}` : ""}`],
    ...(descriptors ? ([[td("vehicle"), descriptors]] as [string, string][]) : []),
    [td("customer"), `${contactCustomer.name} · ${formatPhone(contactCustomer.phone)}`],
  ];

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
        <span className="ml-auto">
          <PrintButton />
        </span>
      </div>

      {/* the always-light document (D-1) */}
      <div className="q-doc border border-zinc-300 bg-white p-8 text-[13px] text-zinc-900 shadow-sm">
        <header className="flex items-start justify-between gap-4 border-b-2 border-zinc-800 pb-4">
          <div>
            <div className="text-lg font-bold">{repairCase.shop.name}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">{td("title")}</div>
            <div className="text-[10px] tracking-[0.22em] text-zinc-500">QUOTATION</div>
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr_auto_1fr]">
          {meta.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-zinc-500">{term}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <table className="mt-5 w-full border-collapse">
          <thead>
            <tr className="border-y border-zinc-800 text-left text-[12px]">
              <th className="w-10 py-1.5 pr-2 font-semibold">{td("lineNo")}</th>
              <th className="py-1.5 pr-2 font-semibold">{td("lineTitle")}</th>
              <th className="w-32 py-1.5 text-right font-semibold">{td("lineAmount")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id} className="border-b border-zinc-200 align-top">
                <td className="num py-1.5 pr-2 text-zinc-500">{index + 1}</td>
                <td className="py-1.5 pr-2">
                  {line.title}
                  {line.payerType === "INSURER" && (
                    <span className="ml-1.5 text-[11px] text-zinc-500">
                      ({td("insurerPays")}
                      {line.insurerName ? ` · ${line.insurerName}` : ""})
                    </span>
                  )}
                </td>
                <td className="num py-1.5 text-right tabular-nums">
                  {amount(line.priceSatang)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-800">
              <td />
              <td className="py-2 text-right font-bold">{td("total")}</td>
              <td className="num py-2 text-right font-bold tabular-nums">
                {amount(quotation.totalSatang)}
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-1 text-right text-[11px] text-zinc-500">{td("amountUnit")}</p>

        <footer className="mt-10 flex justify-end">
          <div className="text-center">
            <div className="mb-1 h-px w-52 bg-zinc-400" />
            <div className="text-[12px]">{td("issuedBy")}</div>
            <div className="mt-0.5 text-[12px] font-medium">{quotation.issuedBy.name}</div>
            <div className="text-[11px] text-zinc-500">{thaiDate}</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
