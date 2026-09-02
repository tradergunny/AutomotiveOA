import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  hasActiveWork,
  nextActionFor,
  stageFor,
  waitingBlockerFor,
} from "@/lib/case-flow";
import { LINE_MAX_PHOTOS_PER_UPDATE } from "@/lib/line";
import { buildDraftBody, buildFollowUpDraftBody } from "@/lib/line-draft";
import { findingSeverity } from "@/lib/inspection";
import { offerNeedsSending, quotationLabel } from "@/lib/jobs";
import { caseBalance } from "@/lib/payments";
import { can } from "@/lib/permissions";
import { requireSession, tenantDb } from "@/lib/session";
import { CASE_EVENT_INCLUDE } from "./case-events";
import { CaseHeader } from "./case-header";
import { CaseTimeline } from "./case-timeline";
import {
  CustomerTimeline,
  type ComposerFollowUp,
  type SendBlockedReason,
} from "./customer-timeline";
import { InspectionSection } from "./inspection-section";
import { JOB_INCLUDE, QUOTATION_INCLUDE, toJobDto, toQuotationDto } from "./job-dto";
import { JobsFlowProvider } from "./jobs-flow-context";
import { JobsPanel } from "./jobs-panel";
import { PAYMENT_INCLUDE, toPaymentDto } from "./payment-dto";
import { PaymentsPanel } from "./payments-panel";

// The Repair Case page, rebuilt stage-led (M7.5; D-6 – D-10 on top of the
// M2–M7 machinery). One fixed order, always: Header → Inspection → Jobs →
// Money → Customer Updates → Activity. The header answers "where is this
// car, and what's my next move" through the shared Stage derivation
// (lib/case-flow.ts); sections irrelevant to the current Stage collapse to
// one quiet line instead of reordering. Walkaround photos live in the
// Inspection area; money stays appendable after delivery (M7 ruling).
export default async function CasePage({
  params,
  searchParams,
}: PageProps<"/cases/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [ti, session, db] = await Promise.all([
    getTranslations("inspection"),
    requireSession(),
    tenantDb(),
  ]);
  const tc = await getTranslations("common");

  const repairCase = await db.repairCase.findUnique({
    where: { id },
    include: {
      vehicle: { include: { primaryCustomer: true } },
      contactCustomer: true,
      openedByStaff: true,
      deliveredBy: { select: { name: true } },
      photos: { where: { findingId: null, jobId: null }, orderBy: { capturedAt: "asc" } },
      findings: {
        select: {
          id: true,
          source: true,
          zone: true,
          checklistItem: true,
          jobId: true,
          damageTypes: true,
          condition: true,
          proposedActions: true,
          recordedAt: true,
          confirmedAt: true,
          _count: { select: { photos: true } },
        },
        orderBy: { recordedAt: "desc" },
      },
    },
  });
  if (!repairCase) notFound();

  const [jobs, quotations, catalogItems, staffOptions, events, lineUpdates, lineChannel, lineContact, casePhotos, shop, payments] = await Promise.all([
    db.job.findMany({
      where: { caseId: id },
      include: JOB_INCLUDE,
      orderBy: { createdAt: "asc" },
    }),
    db.quotation.findMany({
      where: { caseId: id },
      include: QUOTATION_INCLUDE,
      orderBy: { version: "desc" },
    }),
    db.serviceCatalogItem.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, priceSatang: true },
    }),
    db.staff.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.caseEvent.findMany({
      where: { caseId: id },
      include: CASE_EVENT_INCLUDE,
      orderBy: { at: "asc" },
    }),
    db.lineUpdate.findMany({
      where: { caseId: id },
      include: {
        sentBy: { select: { name: true } },
        photos: { orderBy: { sortOrder: "asc" }, select: { photoId: true } },
        quotation: { select: { number: true, version: true } },
      },
      orderBy: { sentAt: "desc" },
    }),
    db.shopLineChannel.findUnique({
      where: { shopId: session.shopId },
      select: { id: true },
    }),
    db.lineContact.findFirst({
      where: { customer: { contactCases: { some: { id } } } },
      select: { followState: true },
    }),
    // Every photo on the case — walkaround, Finding evidence and Job progress
    // shots are all attachable to an Update (CONTEXT.md).
    db.photo.findMany({
      where: { caseId: id },
      orderBy: { capturedAt: "asc" },
      select: { id: true, contentType: true, findingId: true, jobId: true },
    }),
    db.shop.findFirst({ select: { name: true } }),
    db.payment.findMany({
      where: { caseId: id },
      include: PAYMENT_INCLUDE,
      orderBy: { recordedAt: "asc" }, // a ledger reads oldest first
    }),
  ]);

  /* ---------- the one derivation everything speaks (M7.5 §1–§2) ---------- */

  const balance = caseBalance(jobs, payments);
  const stage = stageFor(repairCase.status, jobs, balance.totalDueSatang);

  // Accepting a Finding that proposes work already put its line in the Offer
  // (D-24), so the cascade has no grouping step left: unaccepted Findings
  // send the advisor back to the inspection, and the Offer's own facts —
  // unpriced lines, an unsent or stale part — drive the rest.
  const move = nextActionFor(stage, {
    findingsCount: repairCase.findings.length,
    unconfirmedFindingsCount: repairCase.findings.filter((f) => f.confirmedAt === null).length,
    unpricedProposedCount: jobs.filter(
      (job) => job.status === "PROPOSED" && job.priceSatang == null,
    ).length,
    offerNeedsSending: offerNeedsSending(jobs, quotations),
    totalDueSatang: balance.totalDueSatang,
  });
  const blocker = waitingBlockerFor(jobs);
  const technicians = [
    ...new Set(
      jobs
        .filter((job) => job.status === "IN_PROGRESS" && job.assignedStaff)
        .map((job) => job.assignedStaff!.name),
    ),
  ];
  const proposedTotalSatang = jobs
    .filter((job) => job.status === "PROPOSED" && job.priceSatang != null)
    .reduce((sum, job) => sum + job.priceSatang!, 0);

  /* ---------- follow-up deep link (M7 §6) ---------- */

  const followUpParam = query["followup"];
  const followUpId = Array.isArray(followUpParam) ? followUpParam[0] : followUpParam;
  const followUpRow = followUpId
    ? await db.followUp.findUnique({
        where: { id: followUpId },
        select: {
          id: true,
          caseId: true,
          jobTitle: true,
          quotedPriceSatang: true,
          checklistItem: true,
          condition: true,
        },
      })
    : null;
  const followUp = followUpRow?.caseId === id ? followUpRow : null;

  const { vehicle, contactCustomer, photos, findings } = repairCase;
  const severe = findings.filter((f) => findingSeverity(f) === "SEVERE").length;
  const checklistCount = findings.filter((f) => f.source === "CHECKLIST").length;
  const findingPhotoCount = findings.reduce((sum, f) => sum + f._count.photos, 0);
  const lastRecorded = findings[0]?.recordedAt;

  // The Customer Timeline's send gate (M6 brief §6): each blocked reason is a
  // normal, explained state — never an error, and never a hidden control.
  const blockedReason: SendBlockedReason = !lineChannel
    ? "notConnected"
    : !lineContact
      ? "noIdentity"
      : lineContact.followState === "UNFOLLOWED"
        ? "unfollowed"
        : null;

  return (
    <JobsFlowProvider>
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/"
        className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {tc("back")}
      </Link>

      <CaseHeader
        repairCase={{
          id: repairCase.id,
          reference: repairCase.reference,
          status: repairCase.status,
          checkedInAt: repairCase.checkedInAt,
          odometerKm: repairCase.odometerKm,
          readyAt: repairCase.readyAt,
          deliveredAt: repairCase.deliveredAt,
          deliveredByName: repairCase.deliveredBy?.name ?? null,
        }}
        vehicle={{
          id: vehicle.id,
          plate: vehicle.plate,
          bodyType: vehicle.bodyType,
          make: vehicle.make,
          model: vehicle.model,
          color: vehicle.color,
        }}
        contact={{
          id: contactCustomer.id,
          name: contactCustomer.name,
          phone: contactCustomer.phone,
          company: contactCustomer.company,
        }}
        photoId={photos[0]?.id ?? null}
        stage={stage}
        move={move}
        blocker={blocker}
        counts={{
          proposed: jobs.filter((job) => job.status === "PROPOSED").length,
          inProgress: jobs.filter((job) => job.status === "IN_PROGRESS").length,
          inQc: jobs.filter((job) => job.status === "QC").length,
        }}
        technicians={technicians}
        balance={balance}
        proposedTotalSatang={proposedTotalSatang}
        canMarkReady={
          repairCase.status === "CHECKED_IN" &&
          !hasActiveWork(jobs.map((job) => ({ status: job.status })))
        }
        canDeliver={repairCase.status === "READY"}
      />

      <InspectionSection
        caseId={repairCase.id}
        findingsCount={findings.length}
        severeCount={severe}
        checklistCount={checklistCount}
        findingPhotoCount={findingPhotoCount}
        lastRecorded={lastRecorded ? lastRecorded.toISOString() : null}
        walkaroundPhotoIds={photos.map((photo) => photo.id)}
        note={repairCase.note}
        startOpen={jobs.length === 0}
      />

      <JobsPanel
        caseId={repairCase.id}
        initialJobs={jobs.map(toJobDto)}
        initialQuotations={quotations.map(toQuotationDto)}
        catalogItems={catalogItems}
        staffOptions={staffOptions}
        isManager={can(session.role, "catalog.priceOverride")}
        canSignOffQc={can(session.role, "qc.signOff")}
        canCancelJob={can(session.role, "job.cancel")}
        canRevertStep={can(session.role, "job.revertStep")}
        viewerStaffId={session.staffId}
        readOnly={repairCase.status === "DELIVERED"}
        blockedReason={blockedReason}
        recipientName={contactCustomer.name}
        deliveredAt={repairCase.deliveredAt?.toISOString() ?? null}
      />

      <PaymentsPanel
        caseId={repairCase.id}
        initialPayments={payments.map(toPaymentDto)}
        owedCustomerSatang={balance.customer.owedSatang}
        owedInsurerSatang={balance.insurer.owedSatang}
        canVoid={can(session.role, "payment.void")}
        caseDelivered={repairCase.status === "DELIVERED"}
        defaultInsurerName={
          jobs.find((job) => job.payerType === "INSURER" && job.insurerName)?.insurerName ?? null
        }
        startOpen={stage === "READY" || stage === "BALANCE_DUE"}
      />

      <CustomerTimeline
        caseId={repairCase.id}
        initialUpdates={lineUpdates.map((update) => ({
          id: update.id,
          bodyText: update.bodyText,
          deliveryStatus: update.deliveryStatus,
          errorCode: update.errorCode,
          recipientName: update.recipientName,
          sentByName: update.sentBy.name,
          sentAt: update.sentAt.toISOString(),
          photoIds: update.photos.map((photo) => photo.photoId),
          quotationLabel: update.quotation
            ? quotationLabel(update.quotation.number, update.quotation.version)
            : null,
        }))}
        draftBody={
          followUp
            ? buildFollowUpDraftBody({
                shopName: shop?.name ?? "",
                customerName: contactCustomer.name,
                plate: vehicle.plate,
                source: followUp.jobTitle
                  ? {
                      kind: "job",
                      title: followUp.jobTitle,
                      quotedPriceSatang: followUp.quotedPriceSatang,
                    }
                  : {
                      kind: "finding",
                      checklistItem: followUp.checklistItem ?? "",
                      condition: followUp.condition,
                    },
              })
            : buildDraftBody({
                shopName: shop?.name ?? "",
                reference: repairCase.reference,
                plate: vehicle.plate,
                customerName: contactCustomer.name,
                caseStatus: repairCase.status,
                jobs: jobs.map((job) => ({
                  title: job.title,
                  status: job.status,
                  waitingReason: job.waitingReason,
                })),
              })
        }
        photos={casePhotos.map((photo) => ({
          id: photo.id,
          contentType: photo.contentType,
          origin: photo.findingId ? "finding" : photo.jobId ? "job" : "case",
        }))}
        recipientName={contactCustomer.name}
        blockedReason={blockedReason}
        maxPhotos={LINE_MAX_PHOTOS_PER_UPDATE}
        followUp={
          followUp
            ? ({
                id: followUp.id,
                label:
                  followUp.jobTitle ??
                  (followUp.checklistItem
                    ? ti(`checklist.${followUp.checklistItem}` as never)
                    : "—"),
              } satisfies ComposerFollowUp)
            : null
        }
      />

      <CaseTimeline
        events={events}
        checkedInAt={repairCase.checkedInAt}
        openedByName={repairCase.openedByStaff.name}
      />
    </div>
    </JobsFlowProvider>
  );
}
