import type { Metadata } from "next";
import "./globals.css";
import { plexMono, plexSans, plexSansThai } from "./fonts";

export const metadata: Metadata = {
  title: "AutomotiveOA",
  description: "Workshop OS — multi-tenant workshop management + CRM",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark-only MVP (DESIGN.md D-1): the `dark` class is permanent.
    <html
      lang="th"
      className={`${plexSans.variable} ${plexSansThai.variable} ${plexMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
