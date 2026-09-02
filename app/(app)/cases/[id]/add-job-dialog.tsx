"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Segmented } from "@/components/blocks/segmented";
import { Button } from "@/components/ui/button";
import { DialogBody, DialogContent, DialogFooter, DialogRow } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { JobDto } from "@/lib/jobs";
import { formatBaht } from "@/lib/money";
import { cn } from "@/lib/utils";
import { createCatalogJob, createCustomJob, type JobError } from "./job-actions";
import { selectCls } from "./parts-table";

/**
 * One Add job dialog (D-22) in place of the two source-named buttons: a
 * source switch — Standard service (a catalog entry, price locked) or Custom
 * (a typed title, optional price) — with the payer, so a Job is born
 * complete. "Add and another" keeps the multi-job rhythm. Accepted Findings
 * make their own lines (D-24), so there is no From-findings source.
 */

type Source = "catalog" | "custom";
type Payer = "CUSTOMER" | "INSURER";

export function AddJobDialog({
  caseId,
  catalogItems,
  defaultInsurerName,
  onAdded,
  onClose,
}: {
  caseId: string;
  catalogItems: { id: string; name: string; priceSatang: number }[];
  defaultInsurerName: string | null;
  onAdded: (job: JobDto) => void;
  onClose: () => void;
}) {
  const t = useTranslations("jobs");
  const tc = useTranslations("common");
  const [source, setSource] = useState<Source>(catalogItems.length > 0 ? "catalog" : "custom");
  const [catalogItemId, setCatalogItemId] = useState(catalogItems[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [payer, setPayer] = useState<Payer>("CUSTOMER");
  const [insurerName, setInsurerName] = useState(defaultInsurerName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<JobError | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  const item = catalogItems.find((entry) => entry.id === catalogItemId) ?? null;
  const ready =
    source === "catalog" ? item != null : title.trim().length > 0;

  async function submit(another: boolean) {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        source === "catalog"
          ? await createCatalogJob(caseId, { catalogItemId, payerType: payer, insurerName })
          : await createCustomJob(caseId, { title, price, payerType: payer, insurerName });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onAdded(res.value);
      if (!another) {
        onClose();
        return;
      }
      setAddedCount((n) => n + 1);
      setTitle("");
      setPrice("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent title={t("addJob.title")} description={t("addJob.description")}>
      <DialogBody>
        <Segmented
          aria-label={t("addJob.sourceLabel")}
          value={source}
          onChange={(value) => {
            setSource(value);
            setError(null);
          }}
          options={[
            {
              value: "catalog",
              label: t("addJob.source.catalog"),
              disabled: catalogItems.length === 0,
              title: catalogItems.length === 0 ? t("addJob.noCatalog") : undefined,
            },
            { value: "custom", label: t("addJob.source.custom") },
          ]}
        />

        {source === "catalog" ? (
          <>
            <DialogRow label={t("addJob.serviceLabel")}>
              <select
                className={cn(selectCls, "h-8 min-w-0 flex-1")}
                value={catalogItemId}
                onChange={(e) => setCatalogItemId(e.currentTarget.value)}
                autoFocus
              >
                {catalogItems.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </DialogRow>
            <DialogRow label={t("addJob.priceLabel")}>
              <span className="num text-[13px]">{item ? formatBaht(item.priceSatang) : "—"}</span>
              <span className="text-[10.5px] text-faint">{t("addJob.catalogPriceHint")}</span>
            </DialogRow>
          </>
        ) : (
          <>
            <DialogRow label={t("addJob.titleLabel")}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder={t("addJob.titlePlaceholder")}
                className="h-8 min-w-0 flex-1 text-[13px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit(false);
                  }
                }}
              />
            </DialogRow>
            <DialogRow label={t("addJob.priceLabel")}>
              <Input
                value={price}
                onChange={(e) => setPrice(e.currentTarget.value)}
                inputMode="decimal"
                placeholder="0"
                className="num h-8 w-32 text-right text-[13px]"
                aria-label={t("addJob.priceLabel")}
              />
              <span className="text-[10.5px] text-faint">{t("addJob.priceOptional")}</span>
            </DialogRow>
          </>
        )}

        <DialogRow label={t("addJob.payerLabel")}>
          <Segmented
            size="sm"
            aria-label={t("addJob.payerLabel")}
            value={payer}
            onChange={setPayer}
            options={[
              { value: "CUSTOMER", label: t("payer.CUSTOMER") },
              { value: "INSURER", label: t("payer.INSURER") },
            ]}
          />
          {payer === "INSURER" && (
            <Input
              value={insurerName}
              onChange={(e) => setInsurerName(e.currentTarget.value)}
              placeholder={t("insurerPlaceholder")}
              className="h-7 w-44 text-xs"
              autoFocus
            />
          )}
        </DialogRow>

        {error && (
          <p role="alert" className="border border-bad/45 px-2 py-1 text-[11px] text-bad">
            {t(`errors.${error}` as never)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          size="sm"
          disabled={busy || !ready}
          className="h-8 font-semibold"
          onClick={() => void submit(false)}
        >
          {t("addJob.add")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !ready}
          className="h-8"
          onClick={() => void submit(true)}
        >
          {t("addJob.addAnother")}
        </Button>
        {addedCount > 0 && (
          <span className="num text-[11px] text-ok">{t("addJob.added", { count: addedCount })}</span>
        )}
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-8" onClick={onClose}>
          {tc("cancel")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
