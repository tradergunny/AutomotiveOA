# CONTEXT.md — Domain Glossary

Canonical language for the workshop management + CRM platform. These terms are used consistently in code, UI, and docs. ⚠ marks an edge still being settled.

## Product shape

The product is **AutomotiveOA** — multi-tenant B2B SaaS, built first with a pilot Shop, sold to other garages. Every domain object below belongs to exactly one Shop.

Shared multi-tenant deployment: one system, one database, every row scoped to its Shop (ADR-001). One Shop = one physical location in MVP — a garage with branches runs as multiple Shops (revisit if a real pilot customer has branches).

Field-validation note: earlier ⚠ flags were converted to working assumptions on 2026-08-19 to unblock the MVP build. docs/INTERVIEW-QUESTIONS.md remains the checklist for validating them against real garages.

The staff UI is bilingual (Thai/English) from day one; customer-facing LINE messages are Thai-first. Look, feel, and frontend conventions live in docs/design/DESIGN.md.

## Core concepts

### Shop
A garage business using the platform — the tenant. Owns its customers, vehicles, repair cases, staff accounts, and LINE Official Account integration.

Each Shop creates and owns its **own** LINE OA — its brand, its friends list, its LINE message fees. The platform stores the channel credentials and sends on the Shop's behalf; onboarding includes a "connect your LINE OA" step (ADR-002).

### Customer
Always a person — the one the Shop talks to (LINE, phone) — optionally tagged with a company ("Somchai — ABC Logistics") for corporate cars. Phone number is the identity key: at check-in the advisor looks up by phone to decide existing-vs-new. Real fleet accounts (company billing, multiple contacts per organization) are deferred to LATER.

Customer history — spending, visits, declined-Job follow-ups — is relationship data: it belongs to the person and never transfers with a sold car.

### Vehicle
A car. License plate is the everyday lookup key; VIN is optional, captured when convenient (insurance cases usually supply it). A returning car wearing a new plate gets its plate edited in place — history stays, no duplicate Vehicle.

Each Vehicle links to one primary Customer. When a car changes hands, staff re-link the primary Customer at check-in. A Vehicle also carries a body type (sedan or pickup in MVP), which selects the Damage Map artwork.

Vehicle history is physical truth and stays with the car across owners: past repairs, parts replaced, paint work, damage photos.

### Repair Case
The ticket for one vehicle visit. Opened at check-in, closed at delivery. Human reference like RC-1024. Contains one or more Jobs. Carries its own contact person — usually the Vehicle's primary Customer, but whoever actually brought the car.

Lifecycle: **Checked In → Ready → Delivered**. Everything in between is derived from its Jobs and shown as a rollup ("2 In Progress · 1 Waiting Parts") — never set by hand. Ready flips when every authorized Job is Completed, and it is a managed state, not a moment: cars sit at the shop awaiting pickup, and the dashboard tracks them.

### Inspection
The examination that produces Findings. One screen, two capture surfaces: the **Damage Map** — an interactive car diagram rendered as one unfolded five-view sheet (top, front, rear, left, right — insurance-sheet style) where staff tap a body zone (bumper, hood, door, wheel…) to log visible damage — and the **Service Checklist** beside it, a list of mechanical systems and wear items (engine, transmission, brakes, fluids…). Both surfaces produce Findings of the same shape.

Inspection is not a one-time gate at check-in: a mid-repair discovery (hidden damage behind a removed bumper) becomes a new Finding on the same Repair Case at any point before delivery.

### Finding
One thing an inspection turned up. Two flavors, one record type: body damage ("front-left bumper — dent + scratch") from the Damage Map, and service/wear items ("brake pads at 20%", "engine oil past interval") from the Service Checklist. A Finding carries its location or system, condition, photos, and proposed action (repair / repaint / replace / service).

### Job
One line of work on a Repair Case — e.g. "front-left bumper: repair + repaint" or "brake pads: replace". Has its own status, technician, parts, and cost. Customer-facing updates show per-Job status.

A Job fulfils one or more Findings — grouping is normal: three scratched panels down the left side become one "left-side repaint" Job.

Lifecycle: **Proposed → Authorized → Waiting / In Progress → QC → Completed**, with terminal alternatives **Declined** (never authorized) and **Cancelled** (authorized, but stopped before completion). Waiting carries a reason: Parts, Paint Booth, Technician, Other. A failed QC bounces the Job back to In Progress with a reason note ("paint mismatch — repaint required"); the bounce is internal-only. QC as a real sign-off gate is a working assumption pending pilot validation.

Every Job has a **Payer** — the Customer (self-pay) or an insurer via a Claim — and needs **Authorization** before work begins, decided per Job, never all-or-nothing on the visit. For self-pay Jobs the authorization is the Customer's approval; for insurance-paid Jobs, Staff record the insurer/claim authorization. Jobs proceed independently: one can be In Progress while another still awaits authorization.

In MVP every authorization is recorded by Staff after the payer responds (LINE chat, phone, in person; insurer decisions arrive outside the system). The record captures who recorded it, when, and through which channel. Customers do not tap-to-approve inside LINE yet.

A Declined or Cancelled Job stays on the Repair Case permanently — Declined ones are CRM follow-up material ("your windshield is still cracked — want a quote?") — but neither is active work.

A Job's price comes from the Service Catalog when it's a standard service — staff pick the entry and cannot edit the price. Damage/bodywork Jobs are quoted per job, since every dent differs. A Manager can override a catalog price; regular staff cannot.

### Part Line
A structured line on a Job for one required part: name, quantity, cost, supplier/source, order status (**Not Ordered → Ordered → Arrived**), ETA, notes. Exists so the dashboard can show exactly what a Waiting(Parts) Job is waiting for. Inventory/stock management is explicitly **out of MVP** — the system knows what this repair needs and whether it has arrived, nothing more.

### Photo
Attaches at three levels: Repair Case (check-in walkaround), Finding (damage evidence), Job (progress and after-work shots). MVP flow: the advisor shoots check-in and inspection photos straight into the system; mid-repair photos are taken by technicians on their own phones and relayed through the shop's existing LINE group, then uploaded to the Job by office staff — an accepted manual relay for V1. A photo reaches the customer only when Staff attach it to a LINE Update.

### Quotation
A numbered, immutable snapshot of the proposed Jobs and their prices at a moment in time — the formal document (ใบเสนอราคา) sent to whoever pays, printable as PDF. Any change — a Job added after a mid-repair discovery, a Manager price override — issues a new version (Q-1024 → Q-1024-v2), and every old version is kept forever. Approval state lives on Jobs; Quotations prove what was offered, and when.

### Claim
A lightweight record of an insurance claim, attached to a Repair Case: insurer, claim number, a photo/scan of the claim document (ใบเคลม), surveyor contact, status, notes. Insurance-paid Jobs point at the Claim; self-pay Jobs don't. Typical arrival: the customer contacts their insurer first, a surveyor inspects and issues the claim document, and the customer brings car + claim to the Shop.

The system never talks to insurers in MVP — coordination happens outside; Staff record the outcomes. The workflow as described is a working assumption pending garage interviews.

### Payment
Money actually received against a Repair Case: amount, method (cash / transfer / card), date, who paid (Customer or Insurer), note. Deposits and partial payments are simply Payments made early. A Repair Case therefore carries a balance due (authorized work minus Payments) — and Delivered does **not** require zero balance: insurers pay weeks late, so the dashboard lists cases with money outstanding instead. "Customer spending" in the CRM is the sum of that person's real Payments, never an estimate from prices. Formal tax-invoice documents (ใบกำกับภาษี) are out of MVP.

### Service Catalog
The Shop's own price list of standard services (brake pads, oil change, fluids…) with fixed prices. Maintained per Shop by its Manager. Standard-service Jobs take their price from here; damage/bodywork Jobs are priced by quote.

### LINE Update
A message pushed from the Shop's LINE Official Account to a Customer: current status, photos, and a short note — composed and sent by Staff from the system. MVP is push-only: replies land in the LINE OA chat inbox and are handled by Staff there; nothing flows back into the system automatically.

Updates cover all Jobs on the visit regardless of Payer — an insurer footing the bill doesn't change who gets kept informed.

### Internal Timeline vs Customer Timeline
Two deliberately separate narratives. The internal timeline records every operational event for Staff (QC failed, rework, waiting-reason changes). The Customer Timeline is only what Staff chose to send as LINE Updates — curated and human-worded ("Final quality check", not "QC failed — repaint"). No internal event ever auto-publishes to the customer (ADR-003).

### Follow-up
The CRM worklist. Sources: Declined Jobs worth chasing ("windshield still cracked — quoted 18,000฿ in March") and wear/near-expiration Findings that never became authorized work. Staff work the list by hand — open, compose a LINE Update, mark contacted. Nothing here ever auto-sends (ADR-003).

### Staff
Everyone who works at the Shop — expected cast: owner/manager, service advisor / front desk, body technicians, painter, mechanic, possibly parts/admin. Each exists as a Staff record so Jobs can carry an assignee and history stays attributable. A Staff record does **not** imply a login. The cast as listed is a working assumption pending pilot interviews.

### User
A Staff member with a login. MVP is office-driven: only the Service Advisor and the Manager/Owner are Users; technicians are assignable Staff records who report progress verbally. Any Staff record can be promoted to a User later without remodeling (Phase 2: technician mobile view). Permissions stay simple in MVP — the only special rules are the Manager ones: Service Catalog price override, and QC sign-off (Manager or QC-authorized Staff, never the technician who did the work).

## Relationships

Shop → has Customers, Staff, and a Service Catalog. Customer → is primary for Vehicles (a Repair Case's contact may differ). Vehicle visit → opens one Repair Case. Inspection produces Findings → Staff group Findings into priced Jobs, snapshotted as versioned Quotations → every Job gets its Payer's authorization before work begins. Payments accumulate against the Repair Case until its balance clears — possibly after Delivered. Declined Jobs and unactioned wear Findings feed the Follow-up worklist.
