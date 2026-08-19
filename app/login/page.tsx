import { getTranslations } from "next-intl/server";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { LocaleToggle } from "@/components/blocks/locale-toggle";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const t = await getTranslations();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow">{t("common.tagline")}</span>
          <LocaleToggle />
        </div>
        <div className="relative border bg-card p-8">
          <CornerTicks />
          <div className="font-mono text-xl font-semibold tracking-widest">
            AUTOMOTIVE<span className="text-primary">OA</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("auth.subtitle")}</p>
          <div className="my-6 border-t border-dashed" />
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
