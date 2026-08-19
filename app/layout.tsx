import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { plexMono, plexSans, plexSansThai } from "./fonts";

export const metadata: Metadata = {
  title: "AutomotiveOA",
  description: "Workshop OS — multi-tenant workshop management + CRM",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    // Dark-only MVP (DESIGN.md D-1): the `dark` class is permanent.
    <html
      lang={locale}
      className={`${plexSans.variable} ${plexSansThai.variable} ${plexMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
