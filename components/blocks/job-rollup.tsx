import { useTranslations } from "next-intl";
import { jobRollup } from "@/lib/case-flow";
import type { JobStatus, WaitingReason } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { JOB_STATUS_TONE } from "./job-status-badge";

/**
 * The derived status rollup (CONTEXT.md: "2 In Progress · 1 Waiting Parts")
 * — shown on board rows and the case header, never set by hand. Waiting
 * entries carry their reason; hues per D-3.
 */
export function JobRollupChips({
  jobs,
}: {
  jobs: { status: JobStatus; waitingReason: WaitingReason | null }[];
}) {
  const t = useTranslations("jobStatus");
  const tw = useTranslations("waitingReasons");
  const entries = jobRollup(jobs);
  if (entries.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {entries.map((entry) => (
        <span
          key={`${entry.status}-${entry.waitingReason ?? ""}`}
          className={cn(
            "inline-flex items-center border px-1.5 py-px font-mono text-[10px] whitespace-nowrap",
            JOB_STATUS_TONE[entry.status],
          )}
        >
          {entry.count} {t(entry.status)}
          {entry.waitingReason && ` · ${tw(entry.waitingReason)}`}
        </span>
      ))}
    </span>
  );
}
