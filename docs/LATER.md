# LATER — post-MVP parking lot

Deliberate deferrals, so MVP scope stays honest. Each entry was consciously excluded — not forgotten.

- **Tap-to-approve in LINE:** customers authorize Jobs by button. LIFF and customer↔LINE identity linking are no longer the blocker (ADR-006 brings both in for Arrivals); what remains parked is the authorization flow itself. MVP: staff-recorded authorizations.
- **Technician mobile view (Phase 2):** My Jobs / Start work / Waiting / Add photo / Send to QC. Staff records are designed to be promotable to Users, so this needs no remodel.
- **Per-Job QR photo upload:** scan → shoot → upload without CRM access; removes the LINE-group photo relay.
- **Rich LINE messages (Flex), rich menus, message templates:** MVP sends plain text + image messages only.
- **Server-side image conversion for LINE:** LINE accepts JPEG/PNG only, so other formats are filtered out of the Update photo picker rather than converted.
- **Short-lived LINE channel tokens:** MVP stores a pasted long-lived access token (ADR-004); issuing and refreshing tokens ourselves is additive.
- **Silence guard for LINE Updates** ("Level 3", ruled 2026-09-10): an active case that has gone 3 days without any Update gets a per-Job status summary. Needs the system's first scheduler (a cron route) and a new class of unattended send; decided after Level 2 (CONTEXT.md **Progress notice**) has run at the pilot and shown where the gaps are. Supersedes the earlier "dashboard update-nudge" idea, which was the ADR-003-era substitute for sending.
- **Branches/Locations:** one Shop = one location for now; a real multi-branch pilot customer reopens this.
- **Insurer integration:** all insurer coordination happens outside the system in MVP; the Claim record only mirrors outcomes.
- **Inventory/stock management:** Part Lines on Jobs only; no stock, no purchasing module.
- **Tax invoices (ใบกำกับภาษี) / receipts:** MVP records Payments only; compliant invoice documents are a later module.
- **Fleet/corporate accounts:** Customer stays a person with an optional company tag in MVP; organization→contacts→vehicles modeling and company billing come later.
