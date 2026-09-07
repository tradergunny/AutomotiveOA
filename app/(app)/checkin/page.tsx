import { arrivalQueue } from "@/lib/arrivals";
import { tenantDb } from "@/lib/session";
import { CheckinScreen } from "./checkin-screen";

// Check-in (M2 brief §4): the front-desk moment. Opens a Repair Case and
// lands on its page. Since M7.8 the page also carries the Shop's waiting
// Arrivals (ADR-006) — the customers' own notices, pulled into the wizard.
export default async function CheckinPage() {
  const db = await tenantDb();
  const queue = await arrivalQueue(db);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <CheckinScreen initialQueue={queue} />
    </div>
  );
}
