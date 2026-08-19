import { getTranslations } from "next-intl/server";
import { CornerTicks } from "@/components/blocks/corner-ticks";

/** Placeholder body for nav destinations whose feature lands in a later milestone. */
export async function MilestoneStub({ milestone }: { milestone: string }) {
  const t = await getTranslations("stub");

  return (
    <div className="relative mx-auto mt-16 max-w-md border bg-card p-10 text-center">
      <CornerTicks />
      <span className="hatch-soft inline-block border border-primary-dim px-2.5 py-1 font-mono text-[11px] tracking-[0.12em] text-primary">
        {milestone}
      </span>
      <p className="mt-4 text-sm text-muted-foreground">{t("comingIn", { milestone })}</p>
    </div>
  );
}
