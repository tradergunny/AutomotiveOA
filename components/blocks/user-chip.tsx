"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { logout } from "@/app/login/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UserRole } from "@/lib/generated/prisma/enums";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

export function UserChip({ name, role }: { name: string; role: UserRole }) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 border bg-surface-2 px-2 py-1.5 text-left hover:border-border-strong"
        aria-label={t("shell.account")}
      >
        <span className="grid size-7 flex-none place-items-center border border-border-strong font-mono text-[11px] text-primary">
          {initials(name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs leading-tight">{name}</span>
          <span className="block truncate text-[10.5px] leading-tight text-faint">
            {t(`roles.${role}`)}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void logout();
          }}
        >
          <LogOut className="size-4" />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
