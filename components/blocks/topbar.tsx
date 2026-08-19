"use client";

import { usePathname } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { LocaleToggle } from "@/components/blocks/locale-toggle";

const TITLE_KEYS: Record<string, string> = {
  "": "board",
  checkin: "checkin",
  customers: "customers",
  followups: "followups",
  catalog: "catalog",
  settings: "settings",
};

// Client-only clock: rendering the time on the server would hydrate stale.
function DateChip() {
  const format = useFormatter();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="font-mono text-[11px] text-muted-foreground" suppressHydrationWarning>
      {now
        ? `${format.dateTime(now, { day: "numeric", month: "short", year: "numeric" })} · ${format.dateTime(now, { hour: "2-digit", minute: "2-digit", hour12: false })}`
        : ""}
    </span>
  );
}

export function Topbar({ crumb }: { crumb: string }) {
  const t = useTranslations("titles");
  const pathname = usePathname();
  const segment = pathname.split("/")[1] ?? "";
  const titleKey = TITLE_KEYS[segment] ?? "board";

  return (
    <header className="sticky top-0 z-10 flex items-center gap-3.5 border-b bg-sidebar px-6 py-3.5">
      <span className="font-mono text-[11px] text-faint">{crumb} /</span>
      <h1 className="text-[15.5px] font-semibold tracking-[0.01em]">{t(titleKey)}</h1>
      <div className="ml-auto flex items-center gap-2.5">
        <DateChip />
        <LocaleToggle />
        <span className="hatch-soft border border-primary-dim px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-primary">
          M1
        </span>
      </div>
    </header>
  );
}
