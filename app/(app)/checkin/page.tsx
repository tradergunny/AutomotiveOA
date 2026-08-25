import { CheckinWizard } from "./checkin-wizard";

// Check-in (M2 brief §4): the front-desk moment. Opens a Repair Case and
// lands on its page.
export default function CheckinPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <CheckinWizard />
    </div>
  );
}
