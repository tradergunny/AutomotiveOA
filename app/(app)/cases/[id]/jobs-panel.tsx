"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { JobRollupLine } from "@/components/blocks/job-rollup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isQuotable,
  isQuotationStale,
  type JobDto,
  type JobFindingRef,
  type QuotationDto,
} from "@/lib/jobs";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createCatalogJob, createJobFromFindings, type JobError } from "./job-actions";
import { issueQuotation, type QuotationError } from "./quotation-actions";
import { JobCard } from "./job-card";

/**
 * The case page's Jobs section (M4 brief §3, §6, §7; M7.5 D-7/D-8): the Job
 * list with its two creation paths and the quotation lineage. The per-status
 * rollup lives here now — demoted from the header (D-6) to one quiet
 * sentence of detail. Client state holds jobs / quotations / ungrouped
 * findings and reconciles with what server actions return.
 */

type Props = {
  caseId: string;
  initialJobs: JobDto[];
  initialQuotations: QuotationDto[]; // newest first
  initialUngrouped: JobFindingRef[];
  catalogItems: { id: string; name: string; priceSatang: number }[];
  staffOptions: { id: string; name: string }[];
  isManager: boolean;
  canSignOffQc: boolean;
  canCancelJob: boolean;
  canRevertStep: boolean;
  viewerStaffId: string;
  readOnly: boolean;
  preselectFindingId?: string;
};

export function JobsPanel({
  caseId,
  initialJobs,
  initialQuotations,
  initialUngrouped,
  catalogItems,
  staffOptions,
  isManager,
  canSignOffQc,
  canCancelJob,
  canRevertStep,
  viewerStaffId,
  readOnly,
  preselectFindingId,
}: Props) {
  const t = useTranslations("jobs");
  const tq = useTranslations("quotations");
  const ti = useTranslations("inspection");
  const tc = useTranslations("common");
  const format = useFormatter();

  const [jobs, setJobs] = useState(initialJobs);
  const [quotations, setQuotations] = useState(initialQuotations);
  const [ungrouped, setUngrouped] = useState(initialUngrouped);
  const [creator, setCreator] = useState<"findings" | "catalog" | null>(
    preselectFindingId ? "findings" : null,
  );
  const [selectedFindings, setSelectedFindings] = useState<Set<string>>(
    () => new Set(preselectFindingId ? [preselectFindingId] : []),
  );
  const [titleTouched, setTitleTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [payer, setPayer] = useState<"CUSTOMER" | "INSURER">("CUSTOMER");
  const [insurerName, setInsurerName] = useState("");
  const [price, setPrice] = useState("");
  const [catalogItemId, setCatalogItemId] = useState(catalogItems[0]?.id ?? "");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueSelection, setIssueSelection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<JobError | QuotationError | null>(null);

  const findingLabel = (f: JobFindingRef) =>
    f.zone ? ti(`zones.${f.zone}` as never) : ti(`checklist.${f.checklistItem}` as never);

  /* ---------- derived detail (D-6: rollup demoted here) ---------- */

  const totals = useMemo(() => {
    let proposed = 0;
    let authorized = 0;
    let unpriced = 0;
    for (const job of jobs) {
      if (job.priceSatang == null) {
        if (isQuotable(job.status)) unpriced += 1;
        continue;
      }
      if (job.status === "PROPOSED") proposed += job.priceSatang;
      if (job.status === "AUTHORIZED") authorized += job.priceSatang;
    }
    return { proposed, authorized, unpriced };
  }, [jobs]);

  const quotableJobs = jobs.filter((job) => job.priceSatang != null && isQuotable(job.status));
  const latestStale = quotations.length > 0 && isQuotationStale(quotations[0], jobs);

  /* ---------- state reconciliation ---------- */

  function jobChanged(dto: JobDto) {
    setJobs((list) => list.map((job) => (job.id === dto.id ? dto : job)));
  }

  function jobDeleted(job: JobDto) {
    setJobs((list) => list.filter((x) => x.id !== job.id));
    setUngrouped((list) => [...list, ...job.findings]);
  }

  function resetCreator() {
    setCreator(null);
    setSelectedFindings(new Set());
    setTitle("");
    setTitleTouched(false);
    setPayer("CUSTOMER");
    setInsurerName("");
    setPrice("");
  }

  function toggleFinding(id: string) {
    setSelectedFindings((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (!titleTouched) {
        const labels = ungrouped.filter((f) => next.has(f.id)).map(findingLabel);
        setTitle(labels.slice(0, 3).join(" + "));
      }
      return next;
    });
  }

  /* ---------- mutations ---------- */

  async function handleCreateFromFindings() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // A preselected id could point at an already-grouped finding (stale
      // link) — only ever submit ids still on the ungrouped list.
      const findingIds = [...selectedFindings].filter((fid) =>
        ungrouped.some((f) => f.id === fid),
      );
      const res = await createJobFromFindings(caseId, {
        findingIds,
        title,
        price,
        payerType: payer,
        insurerName,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setJobs((list) => [...list, res.value]);
      setUngrouped((list) => list.filter((f) => !findingIds.includes(f.id)));
      resetCreator();
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCatalogJob() {
    if (busy || !catalogItemId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createCatalogJob(caseId, {
        catalogItemId,
        payerType: payer,
        insurerName,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setJobs((list) => [...list, res.value]);
      resetCreator();
    } finally {
      setBusy(false);
    }
  }

  async function handleIssue() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await issueQuotation(caseId, [...issueSelection]);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setQuotations((list) => [res.value, ...list]);
      setIssueOpen(false);
    } finally {
      setBusy(false);
    }
  }

  /* ---------- shared bits ---------- */

  const payerChips = (
    <span className="flex border border-border-strong">
      {(["CUSTOMER", "INSURER"] as const).map((option, index) => (
        <button
          key={option}
          type="button"
          onClick={() => setPayer(option)}
          className={cn(
            "px-2 py-0.5 text-[10.5px]",
            index > 0 && "border-l border-border-strong",
            payer === option ? "bg-primary-soft text-primary" : "text-faint hover:text-foreground",
          )}
          aria-pressed={payer === option}
        >
          {t(`payer.${option}`)}
        </button>
      ))}
    </span>
  );

  const insurerInput = payer === "INSURER" && (
    <Input
      value={insurerName}
      onChange={(e) => setInsurerName(e.currentTarget.value)}
      placeholder={t("insurerPlaceholder")}
      className="h-7 w-44 text-xs"
    />
  );

  const showQuotations = quotations.length > 0 || (!readOnly && quotableJobs.length > 0);

  return (
    <section id="jobs" className="relative scroll-mt-16 border bg-card">
      <CornerTicks />
      <header className="flex flex-col gap-1 border-b border-dashed px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[13px] font-semibold">{t("sectionTitle")}</h3>
          <span className="num text-[11px] text-faint">{jobs.length}</span>
          {/* The per-status rollup, demoted here as a sentence (D-6/D-8). */}
          <JobRollupLine
            className="ml-auto"
            jobs={jobs.map((job) => ({ status: job.status, waitingReason: job.waitingReason }))}
          />
        </div>
        {(totals.proposed > 0 || totals.authorized > 0 || totals.unpriced > 0) && (
          <p className="num flex flex-wrap gap-x-2.5 text-[11px] text-muted-foreground">
            {totals.proposed > 0 && (
              <span>{t("totalProposed", { amount: formatBaht(totals.proposed) })}</span>
            )}
            {totals.authorized > 0 && (
              <span>{t("totalAuthorized", { amount: formatBaht(totals.authorized) })}</span>
            )}
            {totals.unpriced > 0 && (
              <span className="text-warn">{t("countUnpriced", { count: totals.unpriced })}</span>
            )}
          </p>
        )}
      </header>

      {jobs.length === 0 ? (
        <p className="px-4 py-4 text-xs text-faint sm:px-5">
          {readOnly ? t("emptyReadOnly") : t("empty")}
        </p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              quotations={quotations}
              staffOptions={staffOptions}
              isManager={isManager}
              canSignOffQc={canSignOffQc}
              canCancelJob={canCancelJob}
              canRevertStep={canRevertStep}
              viewerStaffId={viewerStaffId}
              readOnly={readOnly}
              onChanged={jobChanged}
              onDeleted={jobDeleted}
            />
          ))}
        </ul>
      )}

      {/* creation paths */}
      {!readOnly && (
        <div className="flex flex-col gap-2.5 border-t border-dashed px-4 py-3 sm:px-5">
          {creator == null ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setCreator("findings")}
              >
                <Plus data-icon="inline-start" />
                {t("createFromFindings")}
                {ungrouped.length > 0 && (
                  <span className="num ml-1 text-[10px] text-primary">({ungrouped.length})</span>
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setCreator("catalog")}
                disabled={catalogItems.length === 0}
                title={catalogItems.length === 0 ? t("noCatalogItems") : undefined}
              >
                <Plus data-icon="inline-start" />
                {t("createFromCatalog")}
              </Button>
            </div>
          ) : creator === "findings" ? (
            <div className="flex flex-col gap-2 border border-dashed p-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("createFromFindings")}
              </span>
              {ungrouped.length === 0 ? (
                <span className="text-[11px] text-faint">{t("noUngroupedFindings")}</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {ungrouped.map((f) => {
                    const on = selectedFindings.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleFinding(f.id)}
                        className={cn(
                          "border px-2 py-0.5 text-[11px]",
                          on
                            ? "border-primary-dim bg-primary-soft text-primary"
                            : "border-border-strong text-faint hover:text-foreground",
                        )}
                        aria-pressed={on}
                      >
                        {findingLabel(f)}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.currentTarget.value);
                    setTitleTouched(true);
                  }}
                  placeholder={t("titlePlaceholder")}
                  className="h-8 min-w-0 flex-1 text-[13px]"
                />
                <Input
                  value={price}
                  onChange={(e) => setPrice(e.currentTarget.value)}
                  placeholder={t("priceOptionalPlaceholder")}
                  inputMode="decimal"
                  className="num h-8 w-28 text-right text-[13px]"
                />
                {payerChips}
                {insurerInput}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !title.trim()}
                  className="h-7 font-semibold"
                  onClick={() => void handleCreateFromFindings()}
                >
                  {t("createJob")}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={resetCreator}>
                  {tc("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 border border-dashed p-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("createFromCatalog")}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  className="min-w-0 flex-1 border border-border-strong bg-transparent px-1.5 py-1.5 text-xs focus:border-primary focus:outline-none [&>option]:bg-popover"
                  value={catalogItemId}
                  onChange={(e) => setCatalogItemId(e.currentTarget.value)}
                >
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {formatBaht(item.priceSatang)}
                    </option>
                  ))}
                </select>
                {payerChips}
                {insurerInput}
              </div>
              <p className="text-[10.5px] text-faint">{t("catalogPriceHint")}</p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !catalogItemId}
                  className="h-7 font-semibold"
                  onClick={() => void handleCreateCatalogJob()}
                >
                  {t("createJob")}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={resetCreator}>
                  {tc("cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* quotations — no scaffolding when there is nothing to show (D-7) */}
      {showQuotations && (
        <div
          id="quotations"
          className="flex scroll-mt-16 flex-col gap-2 border-t border-dashed px-4 py-3 sm:px-5"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-medium text-muted-foreground">{tq("sectionTitle")}</span>
            {latestStale && <span className="text-[11px] text-warn">{tq("stale")}</span>}
            {!readOnly && !issueOpen && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-7"
                disabled={quotableJobs.length === 0}
                title={quotableJobs.length === 0 ? tq("nothingToQuote") : undefined}
                onClick={() => {
                  setIssueSelection(new Set(quotableJobs.map((job) => job.id)));
                  setIssueOpen(true);
                }}
              >
                <Plus data-icon="inline-start" />
                {tq("issue")}
              </Button>
            )}
          </div>

          {issueOpen && (
            <div className="flex flex-col gap-2 border border-dashed p-2.5">
              <span className="text-[11px] text-muted-foreground">{tq("issueHint")}</span>
              <div className="flex flex-col gap-1">
                {quotableJobs.map((job) => {
                  const on = issueSelection.has(job.id);
                  return (
                    <label key={job.id} className="flex cursor-pointer items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setIssueSelection((set) => {
                            const next = new Set(set);
                            if (next.has(job.id)) next.delete(job.id);
                            else next.add(job.id);
                            return next;
                          })
                        }
                        className="accent-[var(--primary)]"
                      />
                      <span className="min-w-0 flex-1 truncate">{job.title}</span>
                      <span className="num">{formatBaht(job.priceSatang!)}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <span className="num text-xs text-muted-foreground">
                  {tq("issueTotal", {
                    amount: formatBaht(
                      quotableJobs
                        .filter((job) => issueSelection.has(job.id))
                        .reduce((sum, job) => sum + (job.priceSatang ?? 0), 0),
                    ),
                  })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || issueSelection.size === 0}
                  className="ml-auto h-7 font-semibold"
                  onClick={() => void handleIssue()}
                >
                  {tq("issueConfirm")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => setIssueOpen(false)}
                >
                  {tc("cancel")}
                </Button>
              </div>
            </div>
          )}

          {quotations.length > 0 && (
            <ul className="flex flex-col gap-1">
              {quotations.map((quotation, index) => (
                <li key={quotation.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <Link
                    href={`/cases/${caseId}/quotations/${quotation.id}`}
                    className="font-mono text-[12px] font-semibold text-primary hover:underline"
                  >
                    {quotation.label}
                  </Link>
                  <span className="text-faint">
                    {tq("lineCount", { count: quotation.lines.length })}
                  </span>
                  {index === 0 && latestStale && (
                    <span className="text-[11px] text-warn">{tq("staleShort")}</span>
                  )}
                  <span className="num ml-auto">{formatBaht(quotation.totalSatang)}</span>
                  <span className="num text-[10.5px] text-faint">
                    {format.dateTime(new Date(quotation.issuedAt), {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · {quotation.issuedByName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mx-4 mb-3 border border-bad/45 px-2 py-1 text-[11px] text-bad sm:mx-5">
          {t.has(`errors.${error}` as never)
            ? t(`errors.${error}` as never)
            : tq(`errors.${error}` as never)}
        </p>
      )}
    </section>
  );
}
