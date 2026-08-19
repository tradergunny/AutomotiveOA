import { AppSidebar } from "@/components/blocks/app-sidebar";
import { Topbar } from "@/components/blocks/topbar";
import { requireSession, tenantDb } from "@/lib/session";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const db = await tenantDb();
  const shop = await db.shop.findUniqueOrThrow({ where: { id: session.shopId } });

  return (
    <div className="flex flex-1">
      <AppSidebar shopName={shop.name} userName={session.name} role={session.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar crumb={initials(shop.name)} />
        <main className="flex-1 px-6 py-5">{children}</main>
        <footer className="flex gap-3.5 border-t border-dashed px-6 py-2.5 font-mono text-[11px] text-faint">
          <span>
            AUTOMOTIVE<span className="text-primary-dim">OA</span> · M1
          </span>
          <span className="ml-auto">{shop.name}</span>
        </footer>
      </div>
    </div>
  );
}
