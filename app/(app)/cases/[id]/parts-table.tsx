"use client";

import { Check, Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PART_ORDER_STATUSES, type JobDto, type PartLineDto } from "@/lib/jobs";
import { formatBaht, satangToBahtInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { addPartLine, removePartLine, updatePartLine, type JobError } from "./job-actions";

/**
 * The Part Lines table with its permanent entry row (M7.5, unchanged in
 * M7.7 — the brief keeps it as is), lifted out of the Job card so the
 * Offer's expanded row and the Work card share one implementation. Part
 * arrival is an action, not an edit (D-7): the status select is live
 * whenever the table is; editing a line's fields waits for the card's Edit.
 */

export const selectCls =
  "border border-border-strong bg-transparent px-1.5 py-1 text-xs focus:border-primary focus:outline-none [&>option]:bg-popover";

const partHeadCls = "px-1.5 pb-1 text-left text-[10.5px] font-normal text-faint";
const partCellCls = "px-1.5 py-1";

/**
 * The five editable cells of a part line, shared by the edit row and the
 * entry row. They reach their <form> through the form attribute rather than
 * being wrapped in one: a <form> cannot sit between <tbody> and <tr> without
 * the browser hoisting it out of the table. Enter is wired explicitly so
 * typing across the row and pressing Enter is certain to submit.
 */
function PartInputCells({
  line,
  formId,
  nameRef,
}: {
  line?: PartLineDto;
  formId: string;
  nameRef?: Ref<HTMLInputElement>;
}) {
  const t = useTranslations("jobs");
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const form = document.getElementById(formId);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  };
  return (
    <>
      <td className={partCellCls}>
        <div className="flex items-center gap-1.5">
          <Input
            ref={nameRef}
            onKeyDown={submitOnEnter}
            form={formId}
            name="name"
            defaultValue={line?.name ?? ""}
            placeholder={t("parts.name")}
            required
            className="h-7 min-w-24 flex-[3] text-xs"
          />
          <Input
            form={formId}
            onKeyDown={submitOnEnter}
            name="note"
            defaultValue={line?.note ?? ""}
            placeholder={t("parts.note")}
            className="h-7 min-w-16 flex-[2] text-xs"
          />
        </div>
      </td>
      <td className={partCellCls}>
        <Input
          form={formId}
          onKeyDown={submitOnEnter}
          name="quantity"
          type="number"
          min={1}
          max={999}
          defaultValue={line?.quantity ?? 1}
          className="num h-7 w-14 text-right text-xs"
          aria-label={t("parts.quantity")}
        />
      </td>
      <td className={partCellCls}>
        <Input
          form={formId}
          onKeyDown={submitOnEnter}
          name="unitCost"
          defaultValue={line?.unitCostSatang != null ? satangToBahtInput(line.unitCostSatang) : ""}
          inputMode="decimal"
          className="num h-7 w-20 text-right text-xs"
          aria-label={t("parts.unitCost")}
        />
      </td>
      <td className={partCellCls}>
        <Input
          form={formId}
          onKeyDown={submitOnEnter}
          name="supplier"
          defaultValue={line?.supplier ?? ""}
          className="h-7 w-full min-w-20 text-xs"
          aria-label={t("parts.supplier")}
        />
      </td>
      <td className={partCellCls}>
        <Input
          form={formId}
          onKeyDown={submitOnEnter}
          name="etaDate"
          type="date"
          defaultValue={line?.etaDate ?? ""}
          className="num h-7 w-32 text-xs"
          aria-label={t("parts.eta")}
        />
      </td>
    </>
  );
}

export function partsCostSatang(job: Pick<JobDto, "partLines">): number {
  return job.partLines.reduce((sum, line) => sum + (line.unitCostSatang ?? 0) * line.quantity, 0);
}

export function PartsTable({
  job,
  rowsEditable,
  statusLive,
  canAdd,
  addNonce = 0,
  onChanged,
  onError,
}: {
  job: JobDto;
  /** Per-line edit and remove controls (behind the card's Edit). */
  rowsEditable: boolean;
  /** The order-status select is live — part arrival is one tap (D-7). */
  statusLive: boolean;
  /** Offer the entry row at all. */
  canAdd: boolean;
  /** Bump to open the entry row from outside (the ⋯ menu's Add part). */
  addNonce?: number;
  onChanged: (dto: JobDto) => void;
  onError: (error: JobError) => void;
}) {
  const t = useTranslations("jobs");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingPart, setEditingPart] = useState<string | null>(null);

  // Two ids because both forms live outside the table and their fields find
  // them by form=; scoped by job so several expanded cards can coexist.
  const addFormId = `add-part-${job.id}`;
  const editFormId = `edit-part-${job.id}`;
  const addFormRef = useRef<HTMLFormElement>(null);
  const addNameRef = useRef<HTMLInputElement>(null);
  const editingLine = job.partLines.find((line) => line.id === editingPart) ?? null;

  // An outside request (the ⋯ menu's Add part) opens the entry row: state
  // adjusted during render on a changed nonce, focus once the row exists.
  const [seenNonce, setSeenNonce] = useState(addNonce);
  if (addNonce !== seenNonce) {
    setSeenNonce(addNonce);
    if (canAdd) setAdding(true);
  }
  useEffect(() => {
    if (adding) addNameRef.current?.focus();
  }, [adding]);

  const input = (formData: FormData) => ({
    name: String(formData.get("name") ?? ""),
    quantity: String(formData.get("quantity") ?? "1"),
    unitCost: String(formData.get("unitCost") ?? ""),
    supplier: String(formData.get("supplier") ?? ""),
    etaDate: String(formData.get("etaDate") ?? ""),
    note: String(formData.get("note") ?? ""),
  });

  async function run(action: () => Promise<{ ok: true; value: JobDto } | { ok: false; error: JobError }>) {
    if (busy) return false;
    setBusy(true);
    try {
      const res = await action();
      if (!res.ok) {
        onError(res.error);
        return false;
      }
      onChanged(res.value);
      return true;
    } finally {
      setBusy(false);
    }
  }

  // A failed add must leave the row exactly as typed, and a successful one
  // hands the cursor straight back for the next part.
  async function handleAdd(formData: FormData) {
    const ok = await run(() => addPartLine(job.id, input(formData)));
    if (ok) {
      addFormRef.current?.reset();
      addNameRef.current?.focus();
    }
  }

  const showTable = job.partLines.length > 0 || adding;
  if (!showTable && !canAdd) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {showTable && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-xs">
            <thead>
              <tr className="border-b border-dashed">
                <th className={partHeadCls}>{t("parts.col.part")}</th>
                <th className={cn(partHeadCls, "text-right")}>{t("parts.col.qty")}</th>
                <th className={cn(partHeadCls, "text-right")}>{t("parts.col.unit")}</th>
                <th className={partHeadCls}>{t("parts.col.supplier")}</th>
                <th className={partHeadCls}>{t("parts.col.eta")}</th>
                <th className={partHeadCls}>{t("parts.col.status")}</th>
                <th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {job.partLines.map((line) =>
                editingPart === line.id ? (
                  <tr key={line.id} className="border-b border-dashed">
                    <PartInputCells line={line} formId={editFormId} />
                    <td className={partCellCls}>
                      <select
                        form={editFormId}
                        name="orderStatus"
                        defaultValue={line.orderStatus}
                        className={cn(selectCls, "w-full py-0.5 text-[10.5px]")}
                        aria-label={t("parts.col.status")}
                      >
                        {PART_ORDER_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {t(`parts.status.${status}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={cn(partCellCls, "whitespace-nowrap")}>
                      <button
                        type="submit"
                        form={editFormId}
                        disabled={busy}
                        className="p-0.5 text-faint hover:text-primary"
                        aria-label={tc("save")}
                      >
                        <Check className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPart(null)}
                        className="p-0.5 text-faint hover:text-foreground"
                        aria-label={tc("cancel")}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={line.id} className="border-b border-dashed">
                    <td className={partCellCls}>
                      {line.name}
                      {line.note && <span className="ml-1.5 text-faint">· {line.note}</span>}
                    </td>
                    <td className={cn(partCellCls, "num text-right")}>{line.quantity}</td>
                    <td
                      className={cn(
                        partCellCls,
                        "num text-right",
                        line.unitCostSatang == null && "text-faint",
                      )}
                    >
                      {line.unitCostSatang == null ? "—" : formatBaht(line.unitCostSatang)}
                    </td>
                    <td className={cn(partCellCls, !line.supplier && "text-faint")}>
                      {line.supplier || "—"}
                    </td>
                    <td
                      className={cn(
                        partCellCls,
                        "num whitespace-nowrap",
                        !line.etaDate && "text-faint",
                      )}
                    >
                      {line.etaDate
                        ? format.dateTime(new Date(`${line.etaDate}T00:00:00`), {
                            day: "numeric",
                            month: "short",
                          })
                        : "—"}
                    </td>
                    <td className={partCellCls}>
                      {statusLive ? (
                        <select
                          className={cn(
                            selectCls,
                            "w-full py-0.5 text-[10.5px]",
                            line.orderStatus === "ARRIVED"
                              ? "border-ok/50 text-ok"
                              : line.orderStatus === "ORDERED"
                                ? "border-info/50 text-info"
                                : "text-muted-foreground",
                          )}
                          disabled={busy}
                          value={line.orderStatus}
                          aria-label={t("parts.col.status")}
                          onChange={(e) =>
                            void run(() =>
                              updatePartLine(line.id, {
                                name: line.name,
                                quantity: String(line.quantity),
                                unitCost:
                                  line.unitCostSatang != null
                                    ? satangToBahtInput(line.unitCostSatang)
                                    : "",
                                supplier: line.supplier ?? "",
                                etaDate: line.etaDate ?? "",
                                note: line.note ?? "",
                                orderStatus: e.currentTarget.value,
                              }),
                            )
                          }
                        >
                          {PART_ORDER_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {t(`parts.status.${status}`)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={cn(
                            "text-[10.5px]",
                            line.orderStatus === "ARRIVED" ? "text-ok" : "text-muted-foreground",
                          )}
                        >
                          {t(`parts.status.${line.orderStatus}`)}
                        </span>
                      )}
                    </td>
                    <td className={cn(partCellCls, "whitespace-nowrap")}>
                      {rowsEditable && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingPart(line.id)}
                            className="p-0.5 text-faint hover:text-foreground"
                            aria-label={tc("edit")}
                          >
                            <Pencil className="size-3" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => void run(() => removePartLine(line.id))}
                            className="p-0.5 text-faint hover:text-bad"
                            aria-label={t("parts.remove")}
                          >
                            <X className="size-3" aria-hidden />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )}

              {adding && (
                <tr className="bg-surface-2/50">
                  <PartInputCells formId={addFormId} nameRef={addNameRef} />
                  <td className={cn(partCellCls, "text-[10.5px] text-faint")}>
                    {t("parts.status.NOT_ORDERED")}
                  </td>
                  <td className={cn(partCellCls, "whitespace-nowrap")}>
                    <Button
                      type="submit"
                      form={addFormId}
                      size="icon-sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={t("parts.add")}
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </Button>
                    <button
                      type="button"
                      onClick={() => setAdding(false)}
                      className="ml-1 p-0.5 text-faint hover:text-foreground"
                      aria-label={tc("cancel")}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* No headings over nothing (D-7): adding is a small affordance. */}
      {canAdd && !adding && (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setTimeout(() => addNameRef.current?.focus(), 0);
          }}
          className="flex w-fit items-center gap-1 text-[11px] text-faint hover:text-primary"
        >
          <Plus className="size-3" aria-hidden />
          {t("parts.add")}
        </button>
      )}

      {/* The forms those rows submit into (see PartInputCells). */}
      {canAdd && (
        <form id={addFormId} ref={addFormRef} action={(formData) => void handleAdd(formData)} />
      )}
      {editingLine && (
        <form
          id={editFormId}
          action={(formData) => {
            const lineId = editingLine.id;
            setEditingPart(null);
            void run(() =>
              updatePartLine(lineId, {
                ...input(formData),
                orderStatus: String(formData.get("orderStatus") ?? editingLine.orderStatus),
              }),
            );
          }}
        />
      )}
    </div>
  );
}
