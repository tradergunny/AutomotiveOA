import { CarFront } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CornerTicks } from "@/components/blocks/corner-ticks";

// The Case Board earns its real body in M2 (check-in) and M5 (attention
// groups). Until then: an honest empty state in the locked aesthetic.
export default async function BoardPage() {
  const t = await getTranslations("board");

  return (
    <div className="relative mx-auto mt-16 max-w-md border bg-card p-10 text-center">
      <CornerTicks />
      <CarFront className="mx-auto size-6 text-faint" aria-hidden />
      <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
    </div>
  );
}
