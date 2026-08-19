# LATER — post-MVP parking lot

Deliberate deferrals, so MVP scope stays honest. Each entry was consciously excluded — not forgotten.

- **Tap-to-approve in LINE (LIFF):** customers authorize Jobs by button; needs LINE login, webhooks, and customer↔LINE identity linking. MVP: staff-recorded authorizations.
- **Technician mobile view (Phase 2):** My Jobs / Start work / Waiting / Add photo / Send to QC. Staff records are designed to be promotable to Users, so this needs no remodel.
- **Per-Job QR photo upload:** scan → shoot → upload without CRM access; removes the LINE-group photo relay.
- **Automatic customer pings** (e.g. "car is Ready"): forbidden by ADR-003 until that ADR is explicitly revisited.
- **Dashboard update-nudges** ("no LINE update sent in 3 days") — the ADR-003-compatible way to keep comms flowing.
- **Branches/Locations:** one Shop = one location for now; a real multi-branch pilot customer reopens this.
- **Insurer integration:** all insurer coordination happens outside the system in MVP; the Claim record only mirrors outcomes.
- **Inventory/stock management:** Part Lines on Jobs only; no stock, no purchasing module.
- **Tax invoices (ใบกำกับภาษี) / receipts:** MVP records Payments only; compliant invoice documents are a later module.
- **Fleet/corporate accounts:** Customer stays a person with an optional company tag in MVP; organization→contacts→vehicles modeling and company billing come later.
