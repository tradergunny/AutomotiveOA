"use client";

import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBaht } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentDto } from "@/lib/payments";
import { cn } from "@/lib/utils";
import { recordPayment, voidPayment, type PaymentError } from "./payment-actions";

/**
 * The case page's Money section (M7 brief §3; M7.5 D-10): one quiet line —
 * the split balance as a sentence — until Ready/Balance due, then the open
 * M7 ledger with Record payment and the Manager-only one-way void. Works on
 * DELIVERED cases — that is the point (M7 decision 5). The balance stays
 * per payer side (decision 2), rendered as tinted words, never chips (D-8:
 * chips are workflow states only).
 */

type Props = {
  caseId: string;
  initialPayments: PaymentDto[]; // chronological, oldest first
  owedCustomerSatang: number;
  owedInsurerSatang: number;
  canVoid: boolean;
  caseDelivered: boolean;
  defaultInsurerName: string | null;
  /** Open ledger from the start (READY / BALANCE_DUE); one line otherwise. */
  startOpen: boolean;
};

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

export function PaymentsPanel({
  caseId,
  initialPayments,
  owedCustomerSatang,
  owedInsurerSatang,
  canVoid,
  caseDelivered,
  defaultInsurerName,
  startOpen,
}: Props) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const format = useFormatter();

  const [open, setOpen] = useState(startOpen);
  const [payments, setPayments] = useState(initialPayments);
  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("CASH");
  const [payer, setPayer] = useState<"CUSTOMER" | "INSURER">("CUSTOMER");
  const [insurerName, setInsurerName] = useState(defaultInsurerName ?? "");
  const [receivedAt, setReceivedAt] = useState(todayIso);
  const [note, setNote] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PaymentError | null>(null);

  /* ---------- the split balance (M7 decision 2) ---------- */

  const sides = useMemo(() => {
    const paid = { CUSTOMER: 0, INSURER: 0 };
    for (const payment of payments) {
      if (payment.voidedAt == null) paid[payment.payerType] += payment.amountSatang;
    }
    const side = (owedSatang: number, paidSatang: number) => ({
      owedSatang,
      paidSatang,
      dueSatang: owedSatang - paidSatang,
      present: owedSatang !== 0 || paidSatang !== 0,
    });
    return {
      customer: side(owedCustomerSatang, paid.CUSTOMER),
      insurer: side(owedInsurerSatang, paid.INSURER),
    };
  }, [payments, owedCustomerSatang, owedInsurerSatang]);

  /* One tinted word per side — a sentence, not chips (D-8). */
  function sideLine(key: "customer" | "insurer") {
    const side = sides[key];
    if (!side.present) return null;
    const label = t(key === "customer" ? "payer.CUSTOMER" : "payer.INSURER");
    if (side.dueSatang > 0) {
      return (
        <span key={key} className={caseDelivered ? "text-bad" : "text-warn"}>
          {t("dueChip", { payer: label, amount: formatBaht(side.dueSatang) })}
        </span>
      );
    }
    if (side.dueSatang < 0) {
      return (
        <span key={key} className="text-muted-foreground">
          {t("overpaidChip", { payer: label, amount: formatBaht(-side.dueSatang) })}
        </span>
      );
    }
    return (
      <span key={key} className="text-ok">
        {t("settledChip", { payer: label })}
      </span>
    );
  }

  const balanceLines = [sideLine("customer"), sideLine("insurer")].filter(Boolean);

  /* ---------- mutations ---------- */

  function resetForm() {
    setFormOpen(false);
    setAmount("");
    setMethod("CASH");
    setPayer("CUSTOMER");
    setInsurerName(defaultInsurerName ?? "");
    setReceivedAt(todayIso());
    setNote("");
  }

  async function handleRecord() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await recordPayment(caseId, {
        amount,
        method,
        payerType: payer,
        insurerName,
        receivedAt,
        note,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPayments((list) => [...list, res.value]);
      resetForm();
    } finally {
      setBusy(false);
    }
  }

  async function handleVoid(paymentId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await voidPayment(paymentId, voidReason);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPayments((list) => list.map((p) => (p.id === res.value.id ? res.value : p)));
      setVoidingId(null);
      setVoidReason("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="money" className="scroll-mt-16 border bg-card">
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
          {t("sectionTitle")}
        </button>
        <span className="num ml-auto flex flex-wrap items-baseline gap-x-2.5 text-xs">
          {balanceLines.length === 0 ? (
            <span className="text-faint">{t("nothingOwed")}</span>
          ) : (
            balanceLines
          )}
        </span>
      </header>

      {open && (
        <>
          {payments.length === 0 ? (
            <p className="border-t border-dashed px-4 py-3 text-xs text-faint sm:px-5">
              {t("empty")}
            </p>
          ) : (
            <ul className="border-t border-dashed">
              {payments.map((payment) => {
                const voided = payment.voidedAt != null;
                return (
                  <li
                    key={payment.id}
                    className="flex flex-col gap-1 border-b border-dashed px-4 py-2 text-xs last:border-0 sm:px-5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "num text-[13px] font-semibold",
                          voided && "text-faint line-through",
                        )}
                      >
                        {formatBaht(payment.amountSatang)}
                      </span>
                      <span className="text-muted-foreground">
                        {t(`method.${payment.method}`)}
                        {" · "}
                        {payment.payerType === "INSURER"
                          ? (payment.insurerName ?? t("payer.INSURER"))
                          : t("payer.CUSTOMER")}
                      </span>
                      {voided && (
                        <span className="hatch-soft border border-bad/45 px-1.5 py-px font-mono text-[9px] tracking-wider text-bad">
                          {t("voided")}
                        </span>
                      )}
                      <span className="num ml-auto text-[10.5px] text-faint">
                        {format.dateTime(new Date(`${payment.receivedAt}T00:00:00`), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {" · "}
                        {payment.recordedByName}
                      </span>
                      {canVoid && !voided && voidingId !== payment.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setVoidingId(payment.id);
                            setVoidReason("");
                            setError(null);
                          }}
                          className="border border-border-strong px-1.5 py-px text-[10px] text-muted-foreground hover:border-bad/45 hover:text-bad"
                        >
                          {t("void")}
                        </button>
                      )}
                    </div>
                    {payment.note && !voided && (
                      <span className="text-[11px] text-muted-foreground">“{payment.note}”</span>
                    )}
                    {voided && (
                      <span className="text-[11px] text-bad/80">
                        {t("voidedLine", { name: payment.voidedByName ?? "—" })}
                        {payment.voidReason && ` — “${payment.voidReason}”`}
                      </span>
                    )}
                    {voidingId === payment.id && (
                      <div className="flex flex-wrap items-center gap-1.5 border border-dashed border-bad/45 p-2">
                        <Input
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.currentTarget.value)}
                          placeholder={t("voidReasonPlaceholder")}
                          className="h-7 min-w-0 flex-1 text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy || !voidReason.trim()}
                          className="h-7 border-bad/45 text-bad hover:bg-bad/10"
                          onClick={() => void handleVoid(payment.id)}
                        >
                          {t("voidConfirm")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7"
                          onClick={() => setVoidingId(null)}
                        >
                          {tc("cancel")}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-2.5 border-t border-dashed px-4 py-3 sm:px-5">
            {!formOpen ? (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => setFormOpen(true)}
                >
                  <Plus data-icon="inline-start" />
                  {t("record")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 border border-dashed p-2.5">
                <span className="text-xs font-medium text-muted-foreground">{t("record")}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.currentTarget.value)}
                    placeholder={t("amountPlaceholder")}
                    inputMode="decimal"
                    autoFocus
                    className="num h-8 w-28 text-right text-[13px]"
                  />
                  <span className="flex border border-border-strong">
                    {PAYMENT_METHODS.map((option, index) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setMethod(option)}
                        className={cn(
                          "px-2 py-0.5 text-[10.5px]",
                          index > 0 && "border-l border-border-strong",
                          method === option
                            ? "bg-primary-soft text-primary"
                            : "text-faint hover:text-foreground",
                        )}
                        aria-pressed={method === option}
                      >
                        {t(`method.${option}`)}
                      </button>
                    ))}
                  </span>
                  <span className="flex border border-border-strong">
                    {(["CUSTOMER", "INSURER"] as const).map((option, index) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setPayer(option)}
                        className={cn(
                          "px-2 py-0.5 text-[10.5px]",
                          index > 0 && "border-l border-border-strong",
                          payer === option
                            ? "bg-primary-soft text-primary"
                            : "text-faint hover:text-foreground",
                        )}
                        aria-pressed={payer === option}
                      >
                        {t(`payer.${option}`)}
                      </button>
                    ))}
                  </span>
                  {payer === "INSURER" && (
                    <Input
                      value={insurerName}
                      onChange={(e) => setInsurerName(e.currentTarget.value)}
                      placeholder={t("insurerPlaceholder")}
                      className="h-7 w-44 text-xs"
                    />
                  )}
                  <label className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    {t("receivedLabel")}
                    <Input
                      type="date"
                      value={receivedAt}
                      onChange={(e) => setReceivedAt(e.currentTarget.value)}
                      className="num h-7 w-36 text-xs"
                    />
                  </label>
                </div>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.currentTarget.value)}
                  placeholder={t("notePlaceholder")}
                  className="h-7 text-xs"
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !amount.trim()}
                    className="h-7 font-semibold"
                    onClick={() => void handleRecord()}
                  >
                    {t("recordConfirm")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7" onClick={resetForm}>
                    {tc("cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="mx-4 mb-3 border border-bad/45 px-2 py-1 text-[11px] text-bad sm:mx-5">
              {t(`errors.${error}`)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
