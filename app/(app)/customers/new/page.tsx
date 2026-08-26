import { getTranslations } from "next-intl/server";
import { FormCard } from "@/components/blocks/form-card";
import { createCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

export default async function NewCustomerPage() {
  const t = await getTranslations("customers");

  return (
    <FormCard title={t("createTitle")}>
      <CustomerForm action={createCustomer} cancelHref="/customers" />
    </FormCard>
  );
}
