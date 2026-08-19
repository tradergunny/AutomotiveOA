import { getTranslations } from "next-intl/server";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { NavList } from "@/components/blocks/nav-list";
import { UserChip } from "@/components/blocks/user-chip";
import type { UserRole } from "@/lib/generated/prisma/enums";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

export async function AppSidebar({
  shopName,
  userName,
  role,
}: {
  shopName: string;
  userName: string;
  role: UserRole;
}) {
  const t = await getTranslations("common");

  return (
    <aside className="sticky top-0 hidden h-screen w-[228px] flex-none flex-col border-r bg-sidebar px-3.5 py-4 md:flex">
      <div className="relative mb-4 border bg-surface-2 px-3 pb-2.5 pt-3">
        <CornerTicks />
        <div className="font-mono text-sm font-semibold tracking-[0.08em]">
          AUTOMOTIVE<span className="text-primary">OA</span>
        </div>
        <div className="eyebrow mt-0.5">{t("tagline")}</div>
      </div>
      <NavList />
      <div className="mt-auto flex flex-col gap-2 border-t border-dashed pt-3.5">
        <div className="flex items-center gap-2 border bg-surface-2 px-2 py-1.5">
          <span className="grid size-7 flex-none place-items-center border border-border-strong font-mono text-[11px] text-primary">
            {initials(shopName)}
          </span>
          <span className="truncate text-xs">{shopName}</span>
        </div>
        <UserChip name={userName} role={role} />
      </div>
    </aside>
  );
}
