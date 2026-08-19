"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";
import { locales } from "@/i18n/config";
import { cn } from "@/lib/utils";

// The mockup's TH | EN switch: mono squares, active one filled with primary.
export function LocaleToggle() {
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex border border-input" role="group" aria-label="Language">
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => setLocale(l))}
          className={cn(
            "px-2.5 py-1 font-mono text-[11px] uppercase",
            l === locale
              ? "bg-primary font-bold text-primary-foreground"
              : "text-faint hover:text-foreground",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
