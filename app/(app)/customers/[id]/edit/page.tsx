import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FormCard } from "@/components/blocks/form-card";
import { formatPhone } from "@/lib/normalize";
import { tenantDb } from "@/lib/session";
import { updateCustomer } from "../../actions";
import { CustomerForm } from "../../customer-form";

export default async function EditCustomerPage({ params }: PageProps<"/customers/[id]/edit">) {
  const { id } = await params;
  const [t, db] = await Promise.all([getTranslations("customers"), tenantDb()]);

  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  return (
    <FormCard title={t("editTitle")}>
      <CustomerForm
        action={updateCustomer.bind(null, customer.id)}
        initial={{
          name: customer.name,
          phone: formatPhone(customer.phone),
          company: customer.company ?? "",
          note: customer.note ?? "",
        }}
        cancelHref={`/customers/${customer.id}`}
      />
    </FormCard>
  );
}
