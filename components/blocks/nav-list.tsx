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

// Nav from the M0 mockup. Stub destinations carry a dashed milestone chip
// telling staff when the feature lands (MILESTONES.md).
const ITEMS = [
  { href: "/", key: "board", icon: LayoutDashboard },
  { href: "/checkin", key: "checkin", icon: CarFront, milestone: "M2" },
  { href: "/customers", key: "customers", icon: Users, milestone: "M2" },
  { href: "/followups", key: "followups", icon: PhoneOutgoing, milestone: "M7" },
  { href: "/catalog", key: "catalog", icon: Tags, milestone: "M4" },
  { href: "/settings", key: "settings", icon: Settings, milestone: "M6" },
] as const;

export function NavList() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, key, icon: Icon, ...item }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const milestone = "milestone" in item ? item.milestone : undefined;
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
            {active ? (
              <span aria-hidden className="ml-auto size-1.5 bg-primary" />
            ) : (
              milestone && (
                <span className="ml-auto border border-dashed border-border-strong px-1 py-px font-mono text-[9px] tracking-[0.06em] text-faint">
                  {milestone}
                </span>
              )
            )}
          </Link>
        );
      })}
    </nav>
  );
}
