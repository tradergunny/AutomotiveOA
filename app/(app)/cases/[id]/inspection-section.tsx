"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * The case page's Inspection area (M7.5 brief §5; D-10): the findings
 * summary as one sentence, with the walkaround photo grid and the visit note
 * folded in. Once Jobs exist the whole section collapses to that one line —
 * the geography stays, the space goes to where the case now lives.
 */
export function InspectionSection({
  caseId,
  findingsCount,
  severeCount,
  checklistCount,
  findingPhotoCount,
  lastRecorded,
  walkaroundPhotoIds,
  note,
  startOpen,
}: {
  caseId: string;
  findingsCount: number;
  severeCount: number;
  checklistCount: number;
  findingPhotoCount: number;
  lastRecorded: string | null;
  walkaroundPhotoIds: string[];
  note: string | null;
  startOpen: boolean;
}) {
  const t = useTranslations("inspection");
  const tc = useTranslations("cases");
  const format = useFormatter();
  const [open, setOpen] = useState(startOpen);

  const minorCount = findingsCount - severeCount;

  return (
    <section id="inspection" className="scroll-mt-16 border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold hover:text-primary"
        >
          {open ? (
            <ChevronDown className="size-3.5 text-faint" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 text-faint" aria-hidden />
          )}
          {t("summaryTitle")}
        </button>

        {/* the one-sentence answer (D-8): counts as words, not chips */}
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
          {findingsCount === 0 ? (
            <span className="text-faint">{t("notInspected")}</span>
          ) : (
            <>
              <span className="text-foreground">
                {t("summaryFindings", { count: findingsCount })}
              </span>
              {severeCount > 0 && (
                <span>
                  {" — "}
                  <span className="text-bad">{t("summarySevere", { count: severeCount })}</span>
                  {minorCount > 0 && <>, {t("summaryMinor", { count: minorCount })}</>}
                </span>
              )}
              {checklistCount > 0 && <span>· {t("summaryChecklist", { count: checklistCount })}</span>}
              {findingPhotoCount > 0 && (
                <span>· {t("summaryPhotos", { count: findingPhotoCount })}</span>
              )}
            </>
          )}
        </span>

        <Link
          href={`/cases/${caseId}/inspection`}
          className="ml-auto border border-primary-dim px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
        >
          {t("openInspection")} →
        </Link>
      </header>

      {open && (
        <div className="flex flex-col gap-3 border-t border-dashed px-4 py-3 sm:px-5">
          {note && (
            <p className="text-xs leading-relaxed">
              <span className="text-faint">{tc("note")} · </span>
              <span className="whitespace-pre-wrap text-muted-foreground">{note}</span>
            </p>
          )}

          {walkaroundPhotoIds.length > 0 ? (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
              {walkaroundPhotoIds.map((photoId, index) => (
                <a
                  key={photoId}
                  href={`/api/photos/${photoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group border bg-surface-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated route; next/image would re-fetch without the session cookie */}
                  <img
                    src={`/api/photos/${photoId}`}
                    alt={tc("photoAlt", { n: index + 1 })}
                    loading="lazy"
                    className="aspect-square w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                  />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-faint">{tc("noPhotos")}</p>
          )}

          {lastRecorded && (
            <p className={cn("num text-[11px] text-faint")}>
              {t("lastRecorded")} ·{" "}
              {format.dateTime(new Date(lastRecorded), {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
