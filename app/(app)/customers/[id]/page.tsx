import { ArrowLeft, Banknote, Car, MessageCircle, Pencil, PhoneOutgoing, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CaseStatusBadge } from "@/components/blocks/case-status-badge";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { formatBaht } from "@/lib/money";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";

// Customer detail (M2 brief §3; M7 brief §7): the RELATIONSHIP half of the
// history split (M7 ruling 6) — visits (cases where this person was the
// contact), spending (the sum of their own non-voided Payments, never an
// estimate and never insurer money), their payment rows, their Follow-ups,
// their vehicles, and the M6 LINE link state. The physical half — what was
// done to a car — lives on the Vehicle page and stays with the car across
// owners; this page keeps a sold car's visits and spending, because the
// visit happened with this person.
export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const [t, tv, tc, tf, ti, format, db] = await Promise.all([
    getTranslations("customers"),
    getTranslations("vehicles"),
    getTranslations("common"),
    getTranslations("followups"),
    getTranslations("inspection"),
    getFormatter(),
    tenantDb(),
  ]);

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      primaryVehicles: { orderBy: { createdAt: "asc" } },
      lineContacts: { select: { displayName: true, followState: true } },
    },
  });
  if (!customer) notFound();

  const [visits, payments, followUps] = await Promise.all([
    db.repairCase.findMany({
      where: { contactCustomerId: id },
      include: { vehicle: { select: { plate: true } } },
      orderBy: { checkedInAt: "desc" },
      take: 30,
    }),
    // Only CUSTOMER-type Payments carry a customerId — insurer money never
    // reaches this list, and never the spending number (M7 ruling 6).
    db.payment.findMany({
      where: { customerId: id },
      include: { repairCase: { select: { id: true, reference: true } } },
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    db.followUp.findMany({
      where: { customerId: id },
      include: {
        repairCase: { select: { id: true, reference: true, vehicle: { select: { plate: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const spendingSatang = payments.reduce(
    (sum, payment) => sum + (payment.voidedAt == null ? payment.amountSatang : 0),
    0,
  );
  const lineContact = customer.lineContacts[0];

  const shortDate = (date: Date) =>
    format.dateTime(date, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link
        href="/customers"
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {tc("back")}
      </Link>

      <div className="relative border bg-card p-5">
        <CornerTicks />
        <div className="flex items-start gap-3">
          <div>
            <h2 className="text-lg font-semibold">{customer.name}</h2>
            {customer.company && (
              <p className="text-sm text-muted-foreground">{customer.company}</p>
            )}
            <p className="num mt-1.5 text-[13px]">{formatPhone(customer.phone)}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px]">
              <MessageCircle
                className={lineContact ? "size-3.5 text-ok" : "size-3.5 text-faint"}
                aria-hidden
              />
              {!lineContact ? (
                <span className="text-faint">{t("lineNotLinked")}</span>
              ) : lineContact.followState === "UNFOLLOWED" ? (
                <span className="text-bad">{t("lineUnfollowed")}</span>
              ) : (
                <span className="text-ok">
                  {t("lineLinked", { name: lineContact.displayName ?? "—" })}
                </span>
              )}
            </p>
            {customer.note && (
              <p className="mt-2 border-l-2 border-border-strong pl-2.5 text-xs text-muted-foreground">
                {customer.note}
              </p>
            )}
          </div>
          <div className="ml-auto flex flex-col items-end gap-2">
            <div className="text-right">
              <span className="eyebrow block">{t("spending")}</span>
              <span className="num text-lg font-semibold">{formatBaht(spendingSatang)}</span>
              <span className="block text-[10px] text-faint">{t("spendingHint")}</span>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/customers/${customer.id}/edit`}>
                <Pencil data-icon="inline-start" />
                {tc("edit")}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="eyebrow">{t("vehicles")}</h3>
          <Button asChild variant="outline" size="xs" className="ml-auto">
            <Link href={`/vehicles/new?for=${customer.id}`}>
              <Plus data-icon="inline-start" />
              {t("addVehicle")}
            </Link>
          </Button>
        </div>
        {customer.primaryVehicles.length === 0 ? (
          <p className="border border-dashed px-3.5 py-3 text-xs text-faint">{t("noVehicles")}</p>
        ) : (
          <div className="border bg-card">
            {customer.primaryVehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className="flex items-center gap-3 border-b border-dashed px-3.5 py-2.5 last:border-0"
              >
                <Car className="size-4 text-faint" aria-hidden />
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="border border-border-strong px-2 py-0.5 font-mono text-[13px] hover:border-primary-dim hover:text-primary"
                >
                  {vehicle.plate}
                </Link>
                {vehicle.province && (
                  <span className="text-xs text-muted-foreground">{vehicle.province}</span>
                )}
                <span className="text-xs text-muted-foreground">
                  {tv(`bodyTypes.${vehicle.bodyType}`)}
                  {[vehicle.make, vehicle.model, vehicle.color].filter(Boolean).length > 0 &&
                    ` · ${[vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ")}`}
                </span>
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="ml-auto text-xs text-muted-foreground hover:text-primary"
                >
                  {tv("historyTitle")} →
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("visits")}</h3>
        {visits.length === 0 ? (
          <p className="border border-dashed px-3.5 py-3 text-xs text-faint">{t("noVisits")}</p>
        ) : (
          <div className="border bg-card">
            {visits.map((repairCase) => (
              <Link
                key={repairCase.id}
                href={`/cases/${repairCase.id}`}
                className="flex items-center gap-3 border-b border-dashed px-3.5 py-2.5 last:border-0 hover:bg-surface-2"
              >
                <span className="font-mono text-[13px] font-medium text-primary">
                  {repairCase.reference}
                </span>
                <span className="border border-border-strong px-1.5 py-px font-mono text-[11px]">
                  {repairCase.vehicle.plate}
                </span>
                <CaseStatusBadge status={repairCase.status} />
                <span className="ml-auto font-mono text-[10px] text-faint">
                  {shortDate(repairCase.checkedInAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow flex items-center gap-1.5">
          <Banknote className="size-3.5" aria-hidden />
          {t("payments")}
        </h3>
        {payments.length === 0 ? (
          <p className="border border-dashed px-3.5 py-3 text-xs text-faint">{t("noPayments")}</p>
        ) : (
          <div className="border bg-card">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="flex flex-wrap items-center gap-3 border-b border-dashed px-3.5 py-2 text-xs last:border-0"
              >
                <span
                  className={
                    payment.voidedAt
                      ? "num text-[13px] font-semibold text-faint line-through"
                      : "num text-[13px] font-semibold"
                  }
                >
                  {formatBaht(payment.amountSatang)}
                </span>
                {payment.voidedAt && (
                  <span className="hatch-soft border border-bad/45 px-1.5 py-px font-mono text-[9px] tracking-wider text-bad">
                    {t("voided")}
                  </span>
                )}
                <Link
                  href={`/cases/${payment.repairCase.id}`}
                  className="font-mono text-[11px] text-primary hover:underline"
                >
                  {payment.repairCase.reference}
                </Link>
                <span className="num ml-auto text-[10.5px] text-faint">
                  {shortDate(payment.receivedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow flex items-center gap-1.5">
          <PhoneOutgoing className="size-3.5" aria-hidden />
          {t("followups")}
        </h3>
        {followUps.length === 0 ? (
          <p className="border border-dashed px-3.5 py-3 text-xs text-faint">{t("noFollowups")}</p>
        ) : (
          <div className="border bg-card">
            {followUps.map((followUp) => (
              <div
                key={followUp.id}
                className="flex flex-wrap items-center gap-3 border-b border-dashed px-3.5 py-2 text-xs last:border-0"
              >
                <span className="min-w-0">
                  {followUp.jobTitle ??
                    (followUp.checklistItem
                      ? ti(`checklist.${followUp.checklistItem}` as never)
                      : "—")}
                </span>
                {followUp.quotedPriceSatang != null && (
                  <span className="num text-muted-foreground">
                    {tf("quoted", { amount: formatBaht(followUp.quotedPriceSatang) })}
                  </span>
                )}
                <span className="hatch-soft border border-border-strong px-1.5 py-px font-mono text-[9.5px] tracking-wider text-muted-foreground">
                  {tf(`status.${followUp.status}`)}
                </span>
                <Link
                  href={`/cases/${followUp.repairCase.id}`}
                  className="ml-auto font-mono text-[11px] text-primary hover:underline"
                >
                  {followUp.repairCase.reference}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
