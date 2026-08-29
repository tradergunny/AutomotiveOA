import { useTranslations } from "next-intl";
import type { JobStatus, WaitingReason } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

// Status hues per DESIGN.md D-3: amber = waiting/attention (a Proposed Job
// awaits authorization), green = authorized/done, blue = in-process, red =
// declined, muted = cancelled. The one chip a list row carries (D-8) — a
// Waiting job folds its reason into the same chip rather than growing a
// second one.
export const JOB_STATUS_TONE: Record<JobStatus, string> = {
  PROPOSED: "border-warn/50 text-warn",
  AUTHORIZED: "border-ok/50 text-ok",
  WAITING: "border-warn/50 text-warn",
  IN_PROGRESS: "border-info/50 text-info",
  QC: "border-info/50 text-info",
  COMPLETED: "border-ok/50 text-ok",
  DECLINED: "border-bad/50 text-bad",
  CANCELLED: "border-border-strong text-muted-foreground",
};

export function JobStatusBadge({
  status,
  waitingReason,
}: {
  status: JobStatus;
  waitingReason?: WaitingReason | null;
}) {
  const t = useTranslations("jobStatus");
  const tw = useTranslations("waitingReasons");
  return (
    <span
      className={cn(
        "hatch-soft inline-flex items-center border px-1.5 py-px font-mono text-[10px] tracking-[0.08em] whitespace-nowrap",
        JOB_STATUS_TONE[status],
      )}
    >
      {t(status)}
      {status === "WAITING" && waitingReason && ` · ${tw(waitingReason)}`}
    </span>
  );
}
