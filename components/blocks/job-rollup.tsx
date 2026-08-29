import { useTranslations } from "next-intl";
import { jobRollup } from "@/lib/case-flow";
import type { JobStatus, WaitingReason } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * The derived status rollup (CONTEXT.md: "2 In Progress · 1 Waiting Parts"),
 * rendered as a sentence of tinted words — supporting detail, not chips
 * (M7.5, D-8: a chip means a workflow state and a row gets at most one).
 * Board rows and the Jobs section header share it.
 */

/** D-3 hues, text-only. */
const TONE: Record<JobStatus, string> = {
  PROPOSED: "text-warn",
  AUTHORIZED: "text-ok",
  WAITING: "text-warn",
  IN_PROGRESS: "text-info",
  QC: "text-info",
  COMPLETED: "text-ok",
  DECLINED: "text-bad",
  CANCELLED: "text-muted-foreground",
};

/** Mid-sentence form: first letter down, interior caps (QC) kept. */
function midSentence(label: string): string {
  return label.charAt(0).toLocaleLowerCase() + label.slice(1);
}

export function JobRollupLine({
  jobs,
  className,
}: {
  jobs: { status: JobStatus; waitingReason: WaitingReason | null }[];
  className?: string;
}) {
  const t = useTranslations("jobStatus");
  const tw = useTranslations("waitingReasons");
  const entries = jobRollup(jobs);
  if (entries.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-baseline gap-x-2 text-[11px]", className)}>
      {entries.map((entry) => (
        <span key={`${entry.status}-${entry.waitingReason ?? ""}`} className={TONE[entry.status]}>
          {entry.count} {midSentence(t(entry.status))}
          {entry.waitingReason && ` — ${midSentence(tw(entry.waitingReason))}`}
        </span>
      ))}
    </span>
  );
}
