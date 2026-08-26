/**
 * Shapes shared between the settings page, its actions, and the client
 * component. Kept out of actions.ts because a "use server" module may export
 * async functions only (the job-dto.ts precedent).
 */

export type LineContactDto = {
  id: string;
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  followState: "FOLLOWING" | "UNFOLLOWED";
  firstSeenAt: string;
  lastEventAt: string;
  customer: { id: string; name: string; phone: string } | null;
};

export const CONTACT_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
} as const;

export function toContactDto(row: {
  id: string;
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  followState: "FOLLOWING" | "UNFOLLOWED";
  firstSeenAt: Date;
  lastEventAt: Date;
  customer: { id: string; name: string; phone: string } | null;
}): LineContactDto {
  return {
    id: row.id,
    lineUserId: row.lineUserId,
    displayName: row.displayName,
    pictureUrl: row.pictureUrl,
    followState: row.followState,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastEventAt: row.lastEventAt.toISOString(),
    customer: row.customer,
  };
}
