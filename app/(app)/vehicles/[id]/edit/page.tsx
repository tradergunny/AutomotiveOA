import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FormCard } from "@/components/blocks/form-card";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";
import { updateVehicle } from "../../actions";
import { VehicleForm } from "../../vehicle-form";

export default async function EditVehiclePage({ params }: PageProps<"/vehicles/[id]/edit">) {
  const { id } = await params;
  const [t, db] = await Promise.all([getTranslations("vehicles"), tenantDb()]);

  const vehicle = await db.vehicle.findUnique({ where: { id } });
  if (!vehicle) notFound();

  // Pilot-scale customer picker for primary re-link; searchable picker can
  // come when a real shop outgrows it.
  const customers = await db.customer.findMany({
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
  });

  return (
    <FormCard title={t("editTitle")}>
      <VehicleForm
        action={updateVehicle.bind(null, vehicle.id)}
        initial={{
          plate: vehicle.plate,
          province: vehicle.province ?? "",
          vin: vehicle.vin ?? "",
          bodyType: vehicle.bodyType,
          make: vehicle.make ?? "",
          model: vehicle.model ?? "",
          color: vehicle.color ?? "",
          primaryCustomerId: vehicle.primaryCustomerId,
        }}
        customerOptions={customers.map((customer) => ({
          ...customer,
          phone: formatPhone(customer.phone),
        }))}
        cancelHref={`/customers/${vehicle.primaryCustomerId}`}
      />
    </FormCard>
  );
}
