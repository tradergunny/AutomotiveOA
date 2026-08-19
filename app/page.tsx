import { getTranslations } from "next-intl/server";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { LocaleToggle } from "@/components/blocks/locale-toggle";

// Placeholder proving theme tokens + i18n — replaced by the app shell in M1 step 7.
export default async function Home() {
  const t = await getTranslations();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="relative border bg-card px-10 py-8 text-center">
        <CornerTicks />
        <div className="font-mono text-lg font-semibold tracking-widest">
          AUTOMOTIVE<span className="text-primary">OA</span>
        </div>
        <div className="eyebrow mt-2">{t("common.tagline")}</div>
        <div className="mt-4 text-base font-semibold" data-testid="board-title">
          {t("titles.board")}
        </div>
        <div className="mt-1 text-muted-foreground">{t("roles.ADVISOR")}</div>
        <div className="mt-6 flex items-center justify-center gap-2 border-t border-dashed pt-4">
          <span className="border border-ok/40 px-2 py-0.5 text-[11px] text-ok">OK</span>
          <span className="border border-warn/40 px-2 py-0.5 text-[11px] text-warn hatch-soft">WAIT</span>
          <span className="border border-bad/40 px-2 py-0.5 text-[11px] text-bad">QC FAIL</span>
          <span className="num border border-border-strong px-2 py-0.5 text-[11px] text-muted-foreground">฿12,500</span>
          <LocaleToggle />
        </div>
      </div>
    </main>
  );
}
