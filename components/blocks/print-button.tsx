"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * The quotation "PDF" affordance (M4 brief, founder ruling): the browser's
 * own print dialog — print, or save as PDF. No PDF library anywhere.
 */
export function PrintButton() {
  const t = useTranslations("quotations");
  return (
    <Button type="button" onClick={() => window.print()} className="font-semibold">
      <Printer data-icon="inline-start" />
      {t("print")}
    </Button>
  );
}
