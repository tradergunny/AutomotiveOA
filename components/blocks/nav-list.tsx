"use client";

import {
  CarFront,
  LayoutDashboard,
  PhoneOutgoing,
  Settings,
  Tags,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Nav from the M0 mockup. Every destination is real since M7 — the last
// milestone-stub chip left with the Follow-up worklist's arrival. M7.8 adds
// one count: waiting Arrivals on Check-in, a plain number, never a chip.
const ITEMS = [
  { href: "/", key: "board", icon: LayoutDashboard },
  { href: "/checkin", key: "checkin", icon: CarFront },
  { href: "/customers", key: "customers", icon: Users },
  { href: "/followups", key: "followups", icon: PhoneOutgoing },
  { href: "/catalog", key: "catalog", icon: Tags },
  { href: "/settings", key: "settings", icon: Settings },
] as const;

export function NavList({ counts = {} }: { counts?: Partial<Record<(typeof ITEMS)[number]["key"], number>> }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, key, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const count = counts[key] ?? 0;
        return (
          <Link
            key={key}
            href={href}
            className={cn(
              "flex items-center gap-2.5 border border-transparent px-2.5 py-2 text-[13.5px]",
              active
                ? "border-border bg-surface-2 text-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon className="size-4 flex-none opacity-85" />
            {t(key)}
            {count > 0 && (
              <span className="num ml-auto border border-primary-dim px-1.5 text-[10.5px] leading-[18px] text-primary">
                {count}
              </span>
            )}
            {active && <span aria-hidden className={cn("size-1.5 bg-primary", count === 0 && "ml-auto")} />}
          </Link>
        );
      })}
    </nav>
  );
}
