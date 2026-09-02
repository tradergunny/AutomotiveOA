"use client";

import { cn } from "@/lib/utils";

/**
 * The joined-bar control the inspection screen drew for its two questions
 * (D-15), generalized for the Jobs flow's dialogs (D-20, D-22, D-23): a
 * channel, a payer, a source, a waiting reason, a Yes/No. Cells share the
 * row and are told apart by position and label; the selected cell carries a
 * tint alone. Drawn in `faint` so unpicked options read as available.
 */

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Selected tint — primary by default; `ok` / `bad` for a Yes/No pair. */
  tone?: "primary" | "ok" | "bad" | "warn";
  disabled?: boolean;
  title?: string;
};

const TONE = {
  primary: "bg-primary-soft text-primary",
  ok: "bg-ok/15 text-ok",
  bad: "bg-bad/15 text-bad",
  warn: "bg-warn/15 text-warn",
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <span
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex max-w-full border border-faint", className)}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled || option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            aria-pressed={on}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1 border-l border-faint text-center leading-tight whitespace-nowrap transition-colors first:border-l-0 disabled:cursor-not-allowed disabled:opacity-45",
              size === "md" ? "h-8 px-2.5 text-[12px]" : "h-7 px-2 text-[11px]",
              on
                ? TONE[option.tone ?? "primary"]
                : "text-muted-foreground hover:bg-raise hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}
