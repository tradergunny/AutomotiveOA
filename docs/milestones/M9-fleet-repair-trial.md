# M9 — Fleet repair trial

The first milestone of the new direction. Goal: one Clerk at one workshop counter records every car's Visit faster than paper plus retyping, each car gains a history that stays with it when its driver changes, and the manager can decide whether that is worth paying for. Decided in the 2026-11-08 grill session after the Ratchaphruk taxi cooperative interview. The fleet product replaces the garage product; CONTEXT.md gains **Driver**, **Contract Holder**, **Contract Mismatch**, **Visit**, **Repair Bill**, **Clerk**, **Repair Type**, **Repair Group**, **Workshop** and **Cooperative**.

**Branch:** `m9-fleet-repair-trial` · **Gate:** a two-week trial at one counter meets the pass marks below, and a named decision-maker answers on price.

**How to work this brief.** Step 0 happens first and involves no product code, because most of this brief rests on one machine-transcribed interview. It can change or stop everything after it. Steps 1–9 follow M7.10's rules: one commit or a few per step, tests written before the wiring they test, and `npm test`, `npm run lint` and `npx tsc --noEmit` green before the next step. If a step needs a decision this brief does not make, stop and ask.

## Read first
- [CONTEXT.md](../../CONTEXT.md) — the terms above. Older terms still describe the garage product.
- The interview findings, site visit plan and transcripts in Google Drive: Project Seed > Interviews > Ratchaphruk Taxi CO-CP LTD.
- [lib/tenant.ts](../../lib/tenant.ts) — every new model must be classified, and [tests/tenant-guard.test.ts](../../tests/tenant-guard.test.ts) extended.
- [lib/case-reference.ts](../../lib/case-reference.ts) (transactional numbering), [lib/normalize.ts](../../lib/normalize.ts) (plates), [lib/money.ts](../../lib/money.ts) (satang), [lib/permissions.ts](../../lib/permissions.ts) (roles) — reuse these.
- [app/(app)/cases/[id]/quotations](../../app/(app)/cases/%5Bid%5D/quotations) and [components/blocks/print-button.tsx](../../components/blocks/print-button.tsx) — the existing printable-document pattern.
- [prisma/schema.prisma](../../prisma/schema.prisma) `Vehicle`, `Customer`, `RepairCase`, `Job`, `ServiceCatalogItem` — see the proposal below for why new models sit beside them.
- [AGENTS.md](../../AGENTS.md) — read the Next.js guide in `node_modules/next/dist/docs/` before writing code.

## Scope (in)

### Step 0 — Site visit and clickable mockup
Before the visit, tag the current `main` as `garage-v1` so the garage product stays recoverable. Build a clickable mockup with fake data, showing the counter screen, the car's page with repeat warnings, and the Repair Bill, using the founder's visual reference if it has arrived. Take it to the workshop and collect every answer under **What the site visit must settle**. Update CONTEXT.md and this brief with what changes. Measure the baseline before anything else changes: minutes per Visit on paper plus retyping, with receipt time timed separately.
**Do not start Step 1 until** the founder has reviewed the answers and the workshop has agreed to the trial and to sharing its data.

### Step 1 — Schema
New models, all tenant-classified: `Driver`, `ContractAssignment`, `Cooperative`, `RepairGroup`, `RepairType`, `Visit`, `VisitLine`, `ContractMismatch`.
- `Vehicle` gains its `Cooperative`, and its `primaryCustomerId` and `bodyType` become optional, because imported cars have neither. Handle the resulting type errors in garage code with the smallest guards that compile; do not restyle or extend that code.
- `Driver` has a name and an optional phone. Phone is not an identity key here: their data may lack phones, and drivers may share them.
- `ContractAssignment` links a `Vehicle` and a `Driver` with a contract reference, contract type (`RENT_TO_OWN`, `RENTAL`, `MEMBER_OWNED`, `UNKNOWN`) and start and end dates.
- `Visit` has a per-Workshop reference, opened and closed timestamps, staff attribution, the symptom, `mileageKm`, `mileageMissingReason`, and a snapshot of the charged name. Exactly one of `mileageKm` and `mileageMissingReason` is set.
- `VisitLine` has an optional `RepairType`, a title snapshot, a note (parts go here), the price, the suggested price at the time, and who changed it when they differ.
**Tests:** migration applies on a fresh database; tenant guard passes; a Visit with neither mileage nor a reason is rejected.

### Step 2 — Import, then correct
A command-line script (`npm run fleet:import -- <file>`) reads their list of cars and Contract Holders, in whatever columns Step 0 discovers. It is idempotent, reports what it created, changed and rejected, and never touches a closed Visit. A changed holder ends the old `ContractAssignment` and starts a new one. Run by us for the trial, regularly, likely weekly; no upload screen. The same script path loads the Repair Types the workshop gave us.
**Tests:** re-running a file changes nothing; a changed holder keeps the old assignment's dates; a clerk's Visit correction survives an import and stays a mismatch; closed Visits keep their charged name; a duplicate plate in one Workshop is rejected and reported (`Vehicle` is unique on plate per Shop, ignoring province).

### Step 3 — Open a Visit
The Clerk's home screen is the open Visits list plus one plate box. Typing a plate shows the car, its Cooperative and Contract Holder, and the last few repairs. The Clerk confirms or corrects the holder, enters mileage or a reason, enters the symptom, and optionally who brought it in. A plate that is not found can be created there and then, for the first-visit fallback. A mileage below the car's last reading asks the Clerk to check, and does not block.
**Tests:** one per rule; a correction produces one `ContractMismatch` and leaves the car's holder unchanged; the fallback creates a car with no holder.

### Step 4 — Close a Visit and print the Repair Bill
Add lines by typing a few letters and picking a Repair Type, or by typing freely. A suggested price fills in and can be edited with no approval. Close the Visit and print the Repair Bill in Thai: car, Contract Holder, work, part notes, cost, date and reference. It must not read as a receipt.
**Tests:** closing with no lines is rejected; an edited price records who and from what; a closed Visit cannot be edited by the Clerk; the bill never shows payment status.

### Step 5 — The car's page
One page per car: Cooperative, current Contract Holder and since when, last mileage, and every Visit newest first with who was charged. History stays when the holder changes. No warnings here unless Step 8 is on.
**Tests:** two holders on one car show one history with the right name on each Visit.

### Step 6 — Manager's lists and the office file
For the Manager login: Contract Mismatches to settle, changed prices, and the trial's counts (free-text share, mileage exceptions, Visits entered the same day). A button exports closed Visits for a date range as a file the office can use to enter charges into their instalment program.
**Tests:** a Clerk cannot see these; the export holds each Visit's charged name and total; settled mismatches leave the list.

### Step 7 — Hide the garage product
Navigation shows only the fleet screens. Garage routes, customer LINE sending, Arrivals and public document links are turned off for a fleet Workshop but stay in the code. No deletions during the trial. Fleet Workshop setup needs a real login for the Clerk and Manager, seeded by script.
**Tests:** a fleet login cannot reach a garage route; no LINE message can be sent; the tenant guard still passes.

### Step 8 — Past repairs, only if Step 0 found usable records
Load past repairs as closed Visits, marked as imported, and match their descriptions to Repair Types where possible. Then turn on repeat warnings on the car's page, the "keeps coming back" and cost-per-car lists, and the oil-change due list. **Skip this whole step if the data is not usable**: the trial then tests speed and adoption only, the mockup shows the rest, and these features wait.
**Tests:** a car with three matching repairs in the window warns; freely typed work never triggers a warning; imported Visits are labelled.

### Step 9 — Trial readiness
Taken from M8, only what a trial with real people's data needs: a production database with working backups, a real deploy, restricted logins, and a written permission from the workshop covering the personal data we hold, what it is for, who can see it, and how it is deleted if the trial stops. Have someone qualified check this against Thailand's personal data law (PDPA). Train the Clerk, then run the first week beside the paper logbook and the second without it.

## Scope (out — do not build)
- **Rebrand and visual redesign.** The name, colors and look change, but after the founder's reference arrives, in their own milestone. The trial may use the reference if it is ready, and stays plain if not. M7.11 is cancelled.
- **Live tracking through the workshop:** stages, quality check and the board.
- **Quotations, approvals, Damage Map and Inspection** in the fleet flow.
- **Payments, instalments and receipts.** Those stay in their program. A Repair Bill is not a receipt.
- **Mechanic logins or mechanic screens.**
- **Separate parts rows, stock, suppliers or parts cost.** Parts are a note on the line.
- **Driver-facing LINE reminders.** Some older drivers' phones have no screens, and no one has confirmed they want this.
- **A live connection to their rent-to-own program.** Files only.
- **Rent, GPS, fines and ride-hailing.** The fine and tax-sticker rule is a question to raise with them, not a feature.
- **Upload screens for imports, and a second Workshop.**

## Decisions — ruled by the founder 2026-11-08
1. The fleet product replaces the garage product, rather than running beside it.
2. The brand and whole look change; the visual reference comes later.
3. Repairs charge the Contract Holder, not whoever brought the car in.
4. The trial records Visits (open, closed) and does not track them live.
5. Cars and Contract Holders are imported and corrected by the Clerk; typing at first visit is the fallback.
6. Their contract program is the official record. A Clerk's correction changes that one Visit and raises a Contract Mismatch. Closed Visits never change who they charged.
7. The trial stops at the Repair Bill. Instalments stay in their program, with a file of closed Visits for the office.
8. The Clerk enters everything; mechanics do not use the system.
9. Work is picked from a Repair Type list with free text as the fallback.
10. Prices are suggested and editable with no approval, and changes are visible to the manager.
11. Warnings and manager reports join the trial only if past repairs can be imported.
12. The trial covers every car at this counter, labelled by Cooperative.
13. Mileage is required, with a recorded exception.
14. Their program keeps issuing receipts; receipt time is measured separately.
15. Parts are a simple note on the work.

## Proposals for the founder to veto (not yet ruled)
- **Build new tables beside the garage ones.** `RepairCase` and `Job` carry stages, payers, authorization and a mandatory quality check, and `Customer` requires a unique phone, all of which the fleet product rules out. New `Visit` and `Driver` models are simpler than bending those. This means less code carries over directly than the findings doc implies: login, tenancy, roles, Thai/English, plates, money, numbering, printing and deployment carry over, while most garage screens do not. Old tables stay untouched until after the trial.
- **Code names.** New code uses the new glossary. Renaming or removing garage code waits until the trial has passed.
- **Fixing a closed Visit.** Clerks cannot edit one. A Manager can reopen it with a reason, which is recorded, and the bill reprints with a revision mark. Otherwise a typo on a bill has no remedy.
- **A car with no Contract Holder** (members' own cars, cars between contracts). The Clerk types the name to charge, and it is flagged as a Contract Mismatch for the office.
- **A car that leaves without a repair.** The Clerk closes the Visit with a reason and no lines, with no bill. This is the one exception to Step 4's rule that a closing Visit needs lines.
- **Who brought the car in** is an optional typed name, so it never slows the counter and does not create a Driver.

## What the site visit must settle
**Whether the trial can happen at all**
- Who decides, who pays, and what would this be worth per month?
- Can they export cars and current Contract Holders? How current is that list, and does it include plates?
- Can they export past repairs? How far back, and what do they look like?
- Who can approve sharing each Cooperative's data?
- Why was their earlier repair module not used? Would their own developers build this next?

**Whether the rulings hold**
- Whose name goes on the bill when a friend brings the car in? Who pays on ordinary rentals and members' own cars?
- Do both Cooperatives' cars come to this workshop? Do they need separate bills?
- How do they know which cars are still in the workshop, and for how long?
- Who writes down what was repaired, and when? Can we see a real mechanic's note?
- How do they set prices? Is there a price list, and who can change a price?
- Do they record mileage today? Who could most easily read it when a car arrives?
- What does their repair program print? Is it an official receipt, and does accounting need it?
- How does a repair charge reach the instalment program, and who enters it?
- Do repair days extend a contract? (Part 6 is unclear.)
- Can drivers repair elsewhere, and do those repairs ever get recorded?
- Would they want parts spending per car? Who would enter it?

**What we need to collect**
- Their 30–50 most common repairs, in their own words, with groups and typical prices.
- Photos of a blank and a filled-in paper form, a real mechanic's note and a driver's bill.
- Any problems caused by unpaid fines at tax renewal since August 2026.
- The interviewee's name and role, and the first visit's date.

## Done when
**Before the trial:** on a fresh clone, an import loads a sample file, and a Clerk login opens a Visit by plate, closes it and prints a Thai Repair Bill. A Manager sees the mismatch, changed-price and count lists and exports the file. No fleet login can reach a garage screen or send a LINE message. All tests green; PR opened for founder review.

**Trial pass marks, over two weeks at one counter:**
- At least 90% of Visits entered the same day, with plate, work, cost, and mileage or a recorded exception.
- Median time from arrival to Repair Bill is lower than the Step 0 baseline, with receipt time reported separately.
- Each Visit is typed once, and the paper logbook is no longer used by the end of week two.
- A named decision-maker agrees to a price. If Step 8 was skipped, a smaller commitment to the next stage counts.

Report the share of freely typed work, mileage exceptions and changed prices beside these marks, since each one shows where the design needs work. Record the result in [MILESTONES.md](../MILESTONES.md). If the trial misses these marks, the founder decides between revising, stopping, or returning to `garage-v1`.
