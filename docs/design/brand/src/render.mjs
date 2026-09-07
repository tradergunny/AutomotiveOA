// Renders the LINE OA brand assets: inlines the repo's IBM Plex woff2 into each
// artboard, then screenshots it with headless Chrome at the exact LINE size.
//   node docs/design/brand/src/render.mjs
import { readFileSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = join(SRC, "..");
const FONTS = join(SRC, "../../../../app/fonts");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const b64 = (f) => readFileSync(join(FONTS, f)).toString("base64");
const fontCss = readFileSync(join(SRC, "fonts.css"), "utf8")
  .replace("__F_SANS400__", b64("ibm-plex-sans-latin-400-normal.woff2"))
  .replace("__F_SANS600__", b64("ibm-plex-sans-latin-600-normal.woff2"))
  .replace("__F_SANS700__", b64("ibm-plex-sans-latin-700-normal.woff2"))
  .replace("__F_THAI400__", b64("ibm-plex-sans-thai-thai-400-normal.woff2"))
  .replace("__F_THAI600__", b64("ibm-plex-sans-thai-thai-600-normal.woff2"))
  .replace("__F_MONO500__", b64("ibm-plex-mono-latin-500-normal.woff2"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome's headless screenshot writes the file and then sometimes fails to exit,
// so poll for the artefact and kill it rather than waiting on the process.
async function shoot(srcFile, w, h, outFile) {
  const built = join(SRC, `.build-${outFile}.html`);
  writeFileSync(built, readFileSync(join(SRC, srcFile), "utf8").replace("__FONTCSS__", fontCss));
  const out = join(OUT, outFile);
  rmSync(out, { force: true });
  const child = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--force-device-scale-factor=1", `--user-data-dir=${join(tmpdir(), "chrome-brand-" + outFile)}`,
    "--virtual-time-budget=5000", `--window-size=${w},${h}`,
    `--screenshot=${out}`, `file://${built}`,
  ], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    if (existsSync(out) && statSync(out).size > 0) { await sleep(400); break; }
    await sleep(500);
  }
  child.kill();
  await sleep(300);
  rmSync(built, { force: true });
  rmSync(join(tmpdir(), "chrome-brand-" + outFile), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(existsSync(out) ? `ok      ${outFile}` : `FAILED  ${outFile}`);
}

await shoot("profile.html", 640, 640, "line-oa-profile-640.png");
await shoot("cover.html", 1080, 878, "line-oa-cover-1080x878.png");
// preview.html embeds the two PNGs above, so it renders last
await shoot("preview.html", 1240, 760, "line-oa-context-preview.png");
