import localFont from "next/font/local";

// Self-hosted IBM Plex (OFL — see fonts/LICENSE-OFL.txt), per DESIGN.md typography.
// Latin and Thai are separate families at matched weights; the font-family
// stacks in globals.css chain them so the browser falls through per glyph.

export const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});

export const plexSansThai = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-thai-thai-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-thai-thai-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-thai-thai-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-thai-thai-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-thai",
  display: "swap",
});

export const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});
