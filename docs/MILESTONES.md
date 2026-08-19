# MILESTONES.md — build plan

Work proceeds strictly milestone by milestone; each ends with a founder review gate before the next begins. Domain language: [CONTEXT.md](../CONTEXT.md) · Design: [design/DESIGN.md](design/DESIGN.md) · Deferred scope: [LATER.md](LATER.md).

| # | Milestone | Deliverable | Gate |
|---|-----------|-------------|------|
| **M0** | **Visual mockup** ✅ *built, awaiting sign-off* | Clickable dark-mode mockup of the Case Board + Inspection/Damage Map in the locked aesthetic (artifact page, no code project) | Founder approves or vetoes the look |
| **M0.5** | **Version control** ✅ *done* | Git repo at `C:\dev\AutomotiveOA`, pushed to private GitHub `tradergunny/AutomotiveOA`; `.gitignore` ready for the Next.js stack | — |
| M1 | Scaffold & foundation | Next.js + TS + Tailwind + shadcn repo; dark theme tokens; TH/EN i18n plumbing; auth (Advisor/Manager); tenant-guarded data layer (ADR-001); Shop/Staff/User schema; seeded pilot Shop | Login works; shell renders in both languages |
| M2 | Customers, Vehicles & Check-in | Phone-lookup customer create/find; Vehicle by plate (body type); check-in flow opening a Repair Case with walkaround photos | A real check-in can be performed end-to-end |
| M3 | Inspection | Damage Map component (from M0 mockup) + Service Checklist producing photographed Findings, including mid-repair additions | An inspection stores tappable-zone Findings with photos |
| M4 | Jobs & money core | Group Findings → Jobs; catalog + quoted pricing (Manager override); authorization recording per Job (payer, channel); Part Lines; versioned Quotations + PDF | A priced, authorized case with a printable quotation exists |
| M5 | Case Board & internal timeline | Attention-grouped dashboard; Job status flow incl. Waiting reasons and QC gate; internal event log | The shop's day is visible on one screen |
| M6 | LINE integration | Shop LINE OA connect; Customer Timeline composer; push updates with photos (ADR-002/003 honored) | A customer's LINE receives a real update |
| M7 | Payments & CRM | Payment records + balance due on board; Customer/Vehicle history views (history split); Follow-up worklist | Money owed and follow-ups are workable lists |
| M8 | Hardening & pilot readiness | Bilingual copy pass; Claim records on cases; print styles; second-Shop onboarding dry-run; backups | Pilot shop goes live |
