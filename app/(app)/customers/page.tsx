import { Plus, Search, Users } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPhone, normalizePlate } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";

// Customers & Vehicles (M2 brief §3): one searchable list across name,
// phone digits, company, and plate. Detail lives at /customers/[id].
export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const [t, format, db] = await Promise.all([
    getTranslations("customers"),
    getFormatter(),
    tenantDb(),
  ]);

  const digits = q.replace(/\D/g, "");
  const customers = await db.customer.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            {
              primaryVehicles: {
                some: { plate: { contains: normalizePlate(q), mode: "insensitive" } },
              },
            },
          ],
        }
      : {},
    include: {
      primaryVehicles: { select: { id: true, plate: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <Form action="/customers" className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} className="pl-8" />
        </Form>
        <Button asChild className="ml-auto font-semibold">
          <Link href="/customers/new">
            <Plus data-icon="inline-start" />
            {t("newCustomer")}
          </Link>
        </Button>
      </div>

      {customers.length === 0 ? (
        <div className="relative mx-auto mt-12 w-full max-w-md border bg-card p-10 text-center">
          <CornerTicks />
          <Users className="mx-auto size-6 text-faint" aria-hidden />
          <p className="mt-4 text-sm text-muted-foreground">
            {q ? t("noResults", { q }) : t("empty")}
          </p>
        </div>
      ) : (
        <div className="relative border bg-card">
          <CornerTicks />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="eyebrow px-3.5 py-2.5 font-medium">{t("name")}</th>
                <th className="eyebrow px-3.5 py-2.5 font-medium">{t("phone")}</th>
                <th className="eyebrow px-3.5 py-2.5 font-medium">{t("vehicles")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-b border-dashed last:border-0 hover:bg-surface-2">
                  <td className="px-3.5 py-2.5">
                    <Link href={`/customers/${customer.id}`} className="font-medium hover:text-primary">
                      {customer.name}
                    </Link>
                    {customer.company && (
                      <span className="ml-2 text-xs text-muted-foreground">· {customer.company}</span>
                    )}
                    <span className="ml-2 font-mono text-[10px] text-faint">
                      {format.dateTime(customer.createdAt, { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </td>
                  <td className="num px-3.5 py-2.5 text-[13px]">{formatPhone(customer.phone)}</td>
                  <td className="px-3.5 py-2.5">
                    {customer.primaryVehicles.length === 0 ? (
                      <span className="text-xs text-faint">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {customer.primaryVehicles.map((vehicle) => (
                          <span
                            key={vehicle.id}
                            className="border border-border-strong px-1.5 py-px font-mono text-[11px]"
                          >
                            {vehicle.plate}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
