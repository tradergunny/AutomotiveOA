import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FormCard } from "@/components/blocks/form-card";
import { tenantDb } from "@/lib/session";
import { createVehicle } from "../actions";
import { VehicleForm } from "../vehicle-form";

// New vehicle for one customer: /vehicles/new?for=<customerId>.
export default async function NewVehiclePage({ searchParams }: PageProps<"/vehicles/new">) {
  const sp = await searchParams;
  const customerId = typeof sp.for === "string" ? sp.for : "";
  const [t, db] = await Promise.all([getTranslations("vehicles"), tenantDb()]);

  const owner = customerId
    ? await db.customer.findUnique({ where: { id: customerId } })
    : null;
  if (!owner) notFound();

  return (
    <FormCard title={t("createTitle")}>
      <VehicleForm
        action={createVehicle.bind(null, owner.id)}
        ownerName={owner.name}
        cancelHref={`/customers/${owner.id}`}
      />
    </FormCard>
  );
}
