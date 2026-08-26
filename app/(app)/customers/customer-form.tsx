"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerFormState, CustomerFormValues } from "./actions";

export function CustomerForm({
  action,
  initial,
  cancelHref,
}: {
  action: (prev: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  initial?: Partial<CustomerFormValues>;
  cancelHref: string;
}) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const [state, formAction, pending] = useActionState(action, {});
  const value = (key: keyof CustomerFormValues) => state.values?.[key] ?? initial?.[key] ?? "";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" defaultValue={value("name")} required autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">{t("phone")}</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          className="num"
          defaultValue={value("phone")}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="company">
          {t("company")} <span className="text-faint">· {tc("optional")}</span>
        </Label>
        <Input id="company" name="company" defaultValue={value("company")} placeholder={t("companyHint")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">
          {t("note")} <span className="text-faint">· {tc("optional")}</span>
        </Label>
        <Textarea id="note" name="note" defaultValue={value("note")} />
      </div>
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
