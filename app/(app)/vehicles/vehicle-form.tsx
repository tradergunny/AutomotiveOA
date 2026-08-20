"use client";

import { Car, Truck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VehicleFormState, VehicleFormValues } from "./actions";

const BODY_TYPES = [
  { value: "SEDAN", icon: Car },
  { value: "PICKUP", icon: Truck },
] as const;

export type CustomerOption = { id: string; name: string; phone: string };

export function VehicleForm({
  action,
  initial,
  ownerName,
  customerOptions,
  cancelHref,
}: {
  action: (prev: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;
  initial?: Partial<VehicleFormValues>;
  /** Create mode: the fixed owner, displayed only. */
  ownerName?: string;
  /** Edit mode: selectable primary customer (re-link at ownership change). */
  customerOptions?: CustomerOption[];
  cancelHref: string;
}) {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(action, {});
  const value = (key: keyof VehicleFormValues) => state.values?.[key] ?? initial?.[key] ?? "";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plate">{t("plate")}</Label>
          <Input id="plate" name="plate" className="font-mono" defaultValue={value("plate")} required autoFocus />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="province">
            {t("province")} <span className="text-faint">· {tc("optional")}</span>
          </Label>
          <Input id="province" name="province" defaultValue={value("province")} />
        </div>
      </div>
      {customerOptions && (
        <p className="border-l-2 border-border-strong pl-2.5 text-xs text-muted-foreground">
          {t("plateEditNote")}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm leading-none font-medium">{t("bodyType")}</span>
        <div className="grid grid-cols-2 gap-2">
          {BODY_TYPES.map(({ value: bodyType, icon: Icon }) => (
            <label
              key={bodyType}
              className="flex cursor-pointer items-center justify-center gap-2 border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 has-checked:border-primary has-checked:bg-primary-soft has-checked:text-foreground"
            >
              <input
                type="radio"
                name="bodyType"
                value={bodyType}
                defaultChecked={value("bodyType") === bodyType}
                className="sr-only"
                required
              />
              <Icon className="size-4" aria-hidden />
              {t(`bodyTypes.${bodyType}`)}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {(["make", "model", "color"] as const).map((field) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={field}>
              {t(field)} <span className="text-faint">· {tc("optional")}</span>
            </Label>
            <Input id={field} name={field} defaultValue={value(field)} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vin">
          {t("vin")} <span className="text-faint">· {tc("optional")}</span>
        </Label>
        <Input id="vin" name="vin" className="font-mono" defaultValue={value("vin")} />
      </div>

      {ownerName && (
        <div className="flex items-center gap-2 border border-dashed px-3 py-2 text-sm">
          <span className="eyebrow">{t("owner")}</span>
          <span className="font-medium">{ownerName}</span>
        </div>
      )}
      {customerOptions && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="primaryCustomerId">{t("owner")}</Label>
          <select
            id="primaryCustomerId"
            name="primaryCustomerId"
            defaultValue={value("primaryCustomerId")}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            {customerOptions.map((customer) => (
              <option key={customer.id} value={customer.id} className="bg-popover text-popover-foreground">
                {customer.name} · {customer.phone}
              </option>
            ))}
          </select>
        </div>
      )}

      {state.error && (
        <p role="alert" className="border border-bad/40 px-3 py-2 text-xs text-bad">
          {t(`errors.${state.error}`)}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2">
        <Button type="submit" disabled={pending} className="font-semibold">
          {pending ? tc("saving") : tc("save")}
        </Button>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>{tc("cancel")}</Link>
        </Button>
      </div>
    </form>
  );
}
