import { tenantDb } from "@/lib/session";
import { FOLLOW_UP_INCLUDE, toFollowUpDto } from "./followup-dto";
import { FollowUpsList } from "./followups-list";

// The Follow-up worklist (M7 brief §5): CONTEXT.md's CRM list, minted at
// delivery from declined Jobs and never-actioned wear Findings, worked by
// hand — open the composer, mark contacted, snooze, drop. Nothing here ever
// auto-sends (ADR-003). One indexed table scan at garage scale; state
// filtering happens client-side over the full set.
export default async function FollowUpsPage() {
  const db = await tenantDb();
  const followUps = await db.followUp.findMany({
    include: FOLLOW_UP_INCLUDE,
    orderBy: { createdAt: "desc" }, // freshest leads chase best
    take: 500,
  });

  return <FollowUpsList initialFollowUps={followUps.map(toFollowUpDto)} />;
}
