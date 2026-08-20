import { useTranslations } from "next-intl";
import type { RepairCaseStatus } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

// Status hues per DESIGN.md D-3: blue = in-process, green = done-ish,
// muted = closed. Hatch-soft keeps it in the technical texture language.
const TONE: Record<RepairCaseStatus, string> = {
  CHECKED_IN: "border-info/50 text-info",
  READY: "border-ok/50 text-ok",
  DELIVERED: "border-border-strong text-muted-foreground",
};

export function CaseStatusBadge({ status }: { status: RepairCaseStatus }) {
  const t = useTranslations("caseStatus");
  return (
    <span
      className={cn(
        "hatch-soft inline-flex items-center border px-1.5 py-px font-mono text-[10px] tracking-[0.08em] whitespace-nowrap",
        TONE[status],
      )}
    >
      {t(status)}
    </span>
  );
}
