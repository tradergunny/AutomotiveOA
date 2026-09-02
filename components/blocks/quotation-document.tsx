import { createTranslator } from "next-intl";
import type { PayerType } from "@/lib/generated/prisma/enums";
import { formatPhone } from "@/lib/normalize";
import thMessages from "@/messages/th.json";

/**
 * The quotation document (M4 brief §6, DESIGN.md D-1): the one always-light
 * artifact in a dark-only app, rendered from an immutable snapshot — never
 * the live Jobs. The document's own copy is ALWAYS Thai (founder ruling —
 * customer-facing, like LINE templates), whatever the staff UI locale, so it
 * translates straight from the Thai messages and bypasses the cookie-locale
 * request config on purpose. Since M7.7 (D-25) the staff page and the public
 * /q/[token] page both render this one component, so the customer opens the
 * same numbered document the advisor printed.
 */

export type QuotationDocumentProps = {
  shopName: string;
  label: string;
  issuedAt: Date;
  issuedByName: string;
  reference: string;
  plate: string;
  province: string | null;
  vehicleDescriptors: string;
  customerName: string;
  customerPhone: string;
  lines: {
    id: string;
    title: string;
    priceSatang: number;
    payerType: PayerType;
    insurerName: string | null;
  }[];
  totalSatang: number;
};

export function QuotationDocument(props: QuotationDocumentProps) {
  const td = createTranslator({
    locale: "th",
    messages: thMessages,
    namespace: "quotationDoc",
  });

  // Thai business-document formats: Buddhist-era date, bare amounts with a
  // บาท column header (two decimals, no ฿ per cell).
  const thaiDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(props.issuedAt);
  const amount = (satang: number) =>
    new Intl.NumberFormat("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(satang / 100);

  const meta: [string, string][] = [
    [td("number"), props.label],
    [td("date"), thaiDate],
    [td("caseRef"), props.reference],
    [td("plate"), `${props.plate}${props.province ? ` ${props.province}` : ""}`],
    ...(props.vehicleDescriptors
      ? ([[td("vehicle"), props.vehicleDescriptors]] as [string, string][])
      : []),
    [td("customer"), `${props.customerName} · ${formatPhone(props.customerPhone)}`],
  ];

  return (
    <div className="q-doc border border-zinc-300 bg-white p-6 text-[13px] text-zinc-900 shadow-sm sm:p-8">
      <header className="flex items-start justify-between gap-4 border-b-2 border-zinc-800 pb-4">
        <div>
          <div className="text-lg font-bold">{props.shopName}</div>
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
          {props.lines.map((line, index) => (
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
              <td className="num py-1.5 text-right tabular-nums">{amount(line.priceSatang)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-zinc-800">
            <td />
            <td className="py-2 text-right font-bold">{td("total")}</td>
            <td className="num py-2 text-right font-bold tabular-nums">
              {amount(props.totalSatang)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-1 text-right text-[11px] text-zinc-500">{td("amountUnit")}</p>

      <footer className="mt-10 flex justify-end">
        <div className="text-center">
          <div className="mb-1 h-px w-52 bg-zinc-400" />
          <div className="text-[12px]">{td("issuedBy")}</div>
          <div className="mt-0.5 text-[12px] font-medium">{props.issuedByName}</div>
          <div className="text-[11px] text-zinc-500">{thaiDate}</div>
        </div>
      </footer>
    </div>
  );
}
