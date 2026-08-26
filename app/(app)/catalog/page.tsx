import { can } from "@/lib/permissions";
import { requireSession, tenantDb } from "@/lib/session";
import { CatalogTable } from "./catalog-table";

// Service Catalog (M4 brief §2): the Shop's own price list. Maintenance is
// Manager-only (server-enforced in ./actions.ts); Advisors read.
export default async function CatalogPage() {
  const [session, db] = await Promise.all([requireSession(), tenantDb()]);
  const items = await db.serviceCatalogItem.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, priceSatang: true, active: true, note: true },
  });

  return (
    <CatalogTable
      initialItems={items}
      readOnly={!can(session.role, "catalog.manage")}
    />
  );
}
