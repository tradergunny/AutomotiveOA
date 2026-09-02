import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

/* ---------- tokens lifted from app/globals.css (.dark) ---------- */
const CSS = `
body{margin:0;background:#09090b;color:#f4f4f5;font-family:"IBM Plex Sans","IBM Plex Sans Thai","Segoe UI","Leelawadee UI","Noto Sans Thai",Arial,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:#f97316}a:hover{color:#fb923c}
.num{font-family:"IBM Plex Mono","IBM Plex Sans Thai",Consolas,Menlo,monospace;font-variant-numeric:tabular-nums}
.mono{font-family:"IBM Plex Mono","IBM Plex Sans Thai",Consolas,Menlo,monospace}
.page{padding:16px;width:768px;display:flex;flex-direction:column;gap:20px}
.card{position:relative;border:1px solid #26262a;background:#101012}
.tk{position:absolute;width:8px;height:8px;border-color:#f97316;border-style:solid;border-width:0}
.tk.tl{left:-1px;top:-1px;border-left-width:2px;border-top-width:2px}
.tk.tr{right:-1px;top:-1px;border-right-width:2px;border-top-width:2px}
.tk.bl{left:-1px;bottom:-1px;border-left-width:2px;border-bottom-width:2px}
.tk.br{right:-1px;bottom:-1px;border-right-width:2px;border-bottom-width:2px}
.sec-head{display:flex;align-items:baseline;gap:12px;padding:10px 20px;border-bottom:1px dashed #26262a}
.h3{font-size:13px;font-weight:600}
.faint{color:#6b6b74}.muted{color:#a1a1aa}.warn{color:#f5a623}.ok{color:#22c55e}.bad{color:#ef4444}.info{color:#3b82f6}.primary{color:#f97316}
.t10{font-size:10.5px}.t11{font-size:11px}.t12{font-size:12px}.t13{font-size:13px}.t15{font-size:15px}
.chip{display:inline-flex;align-items:center;border:1px solid;padding:1px 6px;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.08em;white-space:nowrap;background-image:repeating-linear-gradient(-45deg,color-mix(in srgb,currentColor 14%,transparent) 0 1px,transparent 1px 5px)}
.c-proposed,.c-waiting{border-color:rgba(245,166,35,.5);color:#f5a623}
.c-authorized,.c-completed{border-color:rgba(34,197,94,.5);color:#22c55e}
.c-inprogress,.c-qc{border-color:rgba(59,130,246,.5);color:#3b82f6}
.c-declined{border-color:rgba(239,68,68,.5);color:#ef4444}
.c-cancelled{border-color:#3b3b41;color:#a1a1aa}
.btn{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;font-size:12.8px;font-weight:500;border:1px solid transparent;white-space:nowrap;color:#f4f4f5;box-sizing:border-box}
.btn svg{width:14px;height:14px}
.btn-primary{background:#f97316;color:#0c0a09;font-weight:600}
.btn-outline{border-color:#3b3b41;background:rgba(59,59,65,.3)}
.btn-ghost{color:#a1a1aa}
.btn-bad{border-color:rgba(239,68,68,.5);color:#ef4444}
.btn-warn{border-color:rgba(245,166,35,.5);color:#f5a623}
.quiet{display:inline-flex;align-items:center;gap:4px;border:1px solid #3b3b41;padding:2px 8px;font-size:10.5px;color:#6b6b74;white-space:nowrap}
.quiet svg{width:12px;height:12px}
.field{display:inline-flex;align-items:center;height:32px;border:1px solid #3b3b41;background:rgba(59,59,65,.3);padding:0 10px;font-size:14px;color:#f4f4f5;box-sizing:border-box}
.field.ph{color:#a1a1aa}
.sel{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;height:28px;border:1px solid #3b3b41;padding:0 6px 0 8px;font-size:12px;color:#f4f4f5;box-sizing:border-box}
.sel svg{width:12px;height:12px;color:#6b6b74;flex:none}
.seg{display:inline-flex;border:1px solid #3b3b41}
.seg span{padding:0 10px;height:30px;display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#6b6b74;box-sizing:border-box;white-space:nowrap}
.seg span svg{width:12px;height:12px}
.seg span+span{border-left:1px solid #3b3b41}
.seg .on{background:rgba(249,115,22,.12);color:#f97316}
.seg .yes{background:rgba(34,197,94,.15);color:#22c55e}
.seg .no{background:rgba(239,68,68,.15);color:#ef4444}
.seg.sm span{height:26px;padding:0 8px;font-size:11px}
.phase+.phase{border-top:1px dashed #26262a}
.ph-head{display:flex;align-items:baseline;gap:10px;padding:9px 20px 6px}
.ph-title{font-size:12px;font-weight:500;color:#f4f4f5}
.ph-sub{font-size:11px;color:#a1a1aa}
.row{display:flex;align-items:center;gap:10px;padding:0 20px;min-height:40px;border-top:1px dashed #26262a}
.chev{width:14px;height:14px;color:#6b6b74;flex:none}
.title{font-size:13px;font-weight:500;flex:1;min-width:0}
.detail{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:8px 20px 10px 44px;background:rgba(22,22,24,.5);border-top:1px dashed #26262a;font-size:11px;color:#a1a1aa}
.fchip{display:inline-flex;border:1px solid #3b3b41;padding:0 6px;height:20px;align-items:center;font-size:11px;color:#a1a1aa;white-space:nowrap}
.fchip.on{border-color:#9a4d10;background:rgba(249,115,22,.12);color:#f97316}
.thumb{width:56px;height:44px;border:1px solid #26262a;background:#1c1c1f;display:inline-block;box-sizing:border-box}
.thumb.add{width:auto;padding:0 8px;border:1px dashed #3b3b41;display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#6b6b74;background:transparent}
.thumb.add svg{width:14px;height:14px}
.foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 20px;border-top:1px dashed #26262a}
.body{display:flex;flex-direction:column;gap:10px;padding:12px 20px;background:rgba(22,22,24,.4);border-top:1px dashed #26262a}
.line{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.pt{width:100%;border-collapse:collapse;font-size:12px}
.pt th{font-weight:400;color:#6b6b74;font-size:10.5px;text-align:left;padding:0 6px 4px;border-bottom:1px dashed #26262a}
.pt td{padding:5px 6px;border-bottom:1px dashed #26262a;vertical-align:middle}
.pt .r{text-align:right}
.pcell{display:inline-flex;align-items:center;justify-content:flex-end;height:28px;width:112px;border:1px solid #3b3b41;background:rgba(59,59,65,.3);padding:0 8px;font-size:13px;box-sizing:border-box}
.pcell.empty{border-style:dashed;border-color:rgba(245,166,35,.5);color:#f5a623;justify-content:flex-start;font-size:12px}
.act{display:flex;align-items:center;gap:6px;padding-top:10px;border-top:1px dashed #26262a}
.prov{font-size:11px;color:#6b6b74}
.dlg{position:relative;width:540px;border:1px solid #3b3b41;background:#161618}
.dlg-head{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px dashed #26262a}
.dlg-body{display:flex;flex-direction:column;gap:12px;padding:14px 18px}
.dlg-foot{display:flex;align-items:center;gap:8px;padding:12px 18px;border-top:1px dashed #26262a}
.lab{font-size:11px;color:#6b6b74;width:104px;flex:none}
.veil{position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(9,9,11,.74)}
.center{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center}
.lrow{display:flex;align-items:center;gap:10px;padding:0 12px;min-height:40px;border-top:1px dashed #26262a}
.menu{width:200px;border:1px solid #3b3b41;background:#161618;display:flex;flex-direction:column;padding:4px 0}
.menu div{padding:6px 12px;font-size:12px;color:#f4f4f5;display:flex;align-items:center;gap:8px}
.menu div svg{width:13px;height:13px;color:#6b6b74}
.menu .sep{height:1px;background:#26262a;padding:0;margin:4px 0}
.hint{font-size:10.5px;color:#6b6b74}
.tile{position:relative;border:1px solid #26262a;background:#161618;padding:8px 10px 8px 14px;height:72px;box-sizing:border-box;margin:8px 16px 0;display:flex;flex-direction:column;gap:6px}
.tile .sev{position:absolute;left:0;top:0;bottom:0;width:2px;background:#f5a623}
.seg .amb{background:rgba(245,166,35,.15);color:#f5a623}
.tthumb{width:36px;height:28px;border:1px solid #26262a;background:#1c1c1f;display:inline-block;flex:none}
`;

/* ---------- lucide-style inline icons ---------- */
const P = {
  chevR: '<path d="m9 18 6-6-6-6"></path>',
  chevD: '<path d="m6 9 6 6 6-6"></path>',
  plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
  play: '<polygon points="6 3 20 12 6 21 6 3"></polygon>',
  clock: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle>',
  lock: '<rect width="18" height="11" x="3" y="11"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
  more: '<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>',
  check: '<path d="M20 6 9 17l-5-5"></path>',
  x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  undo: '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"></path>',
  ban: '<circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path>',
  package: '<path d="m7.5 4.27 9 5.15"></path><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path>',
};
P.shieldCheck = P.shield + '<path d="m9 12 2 2 4-4"></path>';
P.shieldX = P.shield + '<path d="m14.5 9.5-5 5"></path><path d="m9.5 9.5 5 5"></path>';
const ic = (name, size = 14, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

const ticks = '<span class="tk tl"></span><span class="tk tr"></span><span class="tk bl"></span><span class="tk br"></span>';
const chip = (cls, text) => `<span class="chip ${cls}">${text}</span>`;
const btn = (kind, text, icon = "") => `<span class="btn btn-${kind}">${icon ? ic(icon) : ""}${text}</span>`;
const quiet = (text, icon = "") => `<span class="quiet">${icon ? ic(icon, 12) : ""}${text}</span>`;
const sel = (text, extra = "") => `<span class="sel" style="${extra}"><span>${text}</span>${ic("chevD", 12)}</span>`;
const seg = (cells, extra = "") =>
  `<span class="seg ${extra}">${cells.map(([t, s]) => `<span class="${s ?? ""}">${t}</span>`).join("")}</span>`;
const thumbs = (n) => Array.from({ length: n }, () => '<span class="thumb"></span>').join("");
const addPhoto = () => `<span class="thumb add">${ic("camera")}Add photo</span>`;

const secHead = (count, right = "") =>
  `<header class="sec-head"><span class="h3">Jobs</span><span class="num t11 faint">${count}</span>${right ? `<span style="margin-left:auto" class="t11 muted">${right}</span>` : ""}</header>`;
const phaseHead = (title, sub) =>
  `<div class="ph-head"><span class="ph-title">${title}</span><span class="ph-sub">${sub}</span></div>`;

const offerHeadRow = () =>
  `<div class="row" style="min-height:22px;border-top:0"><span style="width:14px;flex:none"></span><span class="t10 faint" style="flex:1">Job</span><span class="t10 faint" style="width:110px;flex:none">Payer</span><span class="t10 faint" style="width:112px;flex:none;text-align:right">Price</span></div>`;
const offerRow = (open, title, sub, payer, priceHtml) =>
  `<div class="row">${ic(open ? "chevD" : "chevR", 14, "chev")}<span class="title">${title}${sub ? ` <span class="t11 faint" style="font-weight:400">· ${sub}</span>` : ""}</span><span class="t11 faint" style="width:110px;flex:none">${payer}</span><span style="width:112px;flex:none;display:inline-flex;justify-content:flex-end">${priceHtml}</span></div>`;
const livePrice = (v) => `<span class="pcell num">${v}</span>`;
const emptyPrice = () => `<span class="pcell empty">price</span>`;
const lockedPrice = (v) => `<span class="num t13" style="display:inline-flex;align-items:center;gap:5px;color:#f4f4f5">${v}<span class="faint">${ic("lock", 12)}</span></span>`;
const plainPrice = (v, cls = "") => `<span class="num t13 ${cls}">${v}</span>`;

const partsTable = (rows) => `
<table class="pt">
<thead><tr><th>Part</th><th class="r">Qty</th><th class="r">Cost ฿</th><th>Supplier</th><th>ETA</th><th style="width:118px">Status</th></tr></thead>
<tbody>${rows
  .map(
    (r) =>
      `<tr><td>${r.name}${r.note ? ` <span class="faint">· ${r.note}</span>` : ""}</td><td class="r num">${r.qty}</td><td class="r num ${r.cost ? "" : "faint"}">${r.cost ?? "—"}</td><td class="${r.sup ? "" : "faint"}">${r.sup ?? "—"}</td><td class="num ${r.eta ? "" : "faint"}">${r.eta ?? "—"}</td><td>${sel(r.status, `width:112px;height:24px;font-size:10.5px;${r.tone}`)}</td></tr>`,
  )
  .join("")}</tbody>
</table>
<span class="t11 faint" style="display:inline-flex;align-items:center;gap:4px;width:fit-content">${ic("plus", 12)}Add part</span>`;

const TONE = {
  ordered: "border-color:rgba(59,130,246,.5);color:#3b82f6",
  arrived: "border-color:rgba(34,197,94,.5);color:#22c55e",
  none: "color:#a1a1aa",
};

const doc = (body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=IBM+Plex+Sans+Thai:wght@400;500;600&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;display=swap">
  <style>${CSS}</style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;

const files = {};

/* =================== 1 · Building the offer =================== */
files["Main.dc.html"] = doc(`
<div class="page">
  <div class="card" style="display:flex;align-items:center;gap:8px;padding:10px 20px">${ticks}
    <span class="t11 muted">Assessment · 1 job unpriced</span>
    ${btn("primary", "Set prices")}
    <span class="num t13 warn" style="margin-left:auto">฿15,500 proposed</span>
  </div>
  <section class="card">${ticks}
    ${secHead(3)}
    <div class="phase">
      ${phaseHead("Offer", `3 jobs · ฿15,500 proposed · <span class="warn">1 unpriced</span>`)}
      ${offerHeadRow()}
      ${offerRow(true, "Left-side repaint", "", "Customer pays", livePrice("12,000"))}
      <div class="detail">
        <span style="display:inline-flex;align-items:center;gap:6px"><span class="faint">Fulfils</span><span class="fchip">front-left door</span><span class="fchip">rear-left door</span></span>
        <span class="num">2 parts · ฿4,200 cost</span>
        <span style="display:inline-flex;gap:4px">${thumbs(2)}</span>
        <span style="margin-left:auto;display:inline-flex;gap:6px">${quiet("Edit", "pencil")}${quiet("Delete")}</span>
      </div>
      ${offerRow(false, "Brake pads", "catalog", "Customer pays", lockedPrice("฿3,500"))}
      ${offerRow(false, "Rear glass", "", "Customer pays", emptyPrice())}
      <div class="foot">
        ${btn("outline", "Add job", "plus")}
        <span class="t11 faint" style="margin-left:auto">No quotation yet</span>
        ${btn("outline", "Issue quotation")}
        ${btn("outline", "Record response")}
      </div>
    </div>
  </section>
</div>`);

/* =================== Add job dialog =================== */
files["AddJob.dc.html"] = doc(`
<div style="position:relative;width:800px;height:560px;background:#09090b">
  <div class="page">
    <section class="card">${ticks}
      ${secHead(3)}
      <div class="phase">
        ${phaseHead("Offer", `3 jobs · ฿15,500 proposed · <span class="warn">1 unpriced</span>`)}
        ${offerHeadRow()}
        ${offerRow(false, "Left-side repaint", "", "Customer pays", plainPrice("฿12,000"))}
        ${offerRow(false, "Brake pads", "catalog", "Customer pays", lockedPrice("฿3,500"))}
        ${offerRow(false, "Rear glass", "", "Customer pays", emptyPrice())}
        <div class="foot">${btn("outline", "Add job", "plus")}<span class="t11 faint" style="margin-left:auto">No quotation yet</span>${btn("outline", "Issue quotation")}${btn("outline", "Record response")}</div>
      </div>
    </section>
  </div>
  <div class="veil"></div>
  <div class="center">
    <div class="dlg">${ticks}
      <div class="dlg-head"><span class="h3">Add job</span><span class="faint" style="margin-left:auto">${ic("x", 14)}</span></div>
      <div class="dlg-body">
        ${seg([["From findings <span class=\"num\">· 2</span>", "on"], ["Standard service"], ["Custom"]])}
        <div class="line"><span class="lab">Ungrouped</span><span class="fchip on">${ic("check", 11)} Hood · dent · repaint</span><span class="fchip">Front bumper · scratch · repair</span></div>
        <div class="line"><span class="lab">Title</span><span class="field" style="flex:1">Hood — repaint</span></div>
        <div class="line"><span class="lab">Price</span><span class="field num" style="width:140px">4,500</span><span class="lab" style="width:auto;margin-left:8px">Payer</span>${seg([["Customer pays", "on"], ["Insurance"]], "sm")}</div>
      </div>
      <div class="dlg-foot">${btn("primary", "Add job")}${btn("outline", "Add and another")}<span style="margin-left:auto">${btn("ghost", "Cancel")}</span></div>
    </div>
  </div>
</div>`);

/* =================== 2 · Awaiting authorization =================== */
files["AwaitingAuth.dc.html"] = doc(`
<div class="page">
  <div class="card" style="display:flex;align-items:center;gap:8px;padding:10px 20px">${ticks}
    <span class="t11 muted">Authorization · 3 jobs proposed</span>
    ${btn("primary", "Record response")}
    <span class="num t13 warn" style="margin-left:auto">฿22,300 proposed</span>
  </div>
  <section class="card">${ticks}
    ${secHead(3)}
    <div class="phase">
      ${phaseHead("Offer", "3 jobs · ฿22,300 proposed")}
      ${offerHeadRow()}
      ${offerRow(false, "Left-side repaint", "", "Customer pays", livePrice("12,000"))}
      ${offerRow(false, "Brake pads", "catalog", "Customer pays", lockedPrice("฿3,500"))}
      ${offerRow(false, "Rear glass", "", "Customer pays", livePrice("6,800"))}
      <div class="foot">
        ${btn("outline", "Add job", "plus")}
        <span class="t11 muted" style="margin-left:auto"><span class="mono primary" style="font-size:12px;font-weight:600">Q-1031</span> · Sep 2 · covers all 3 jobs</span>
        ${quiet("New version")}
        ${btn("primary", "Record response")}
      </div>
    </div>
  </section>
</div>`);

/* =================== Record response dialog =================== */
const respRow = (title, price, yes) =>
  `<div class="lrow"><span class="title" style="font-weight:400">${title}</span><span class="num t13" style="width:90px;text-align:right">${price}</span>${seg([["Yes", yes === true ? "yes" : ""], ["No", yes === false ? "no" : ""]], "sm")}</div>`;
files["RecordResponse.dc.html"] = doc(`
<div style="position:relative;width:800px;height:640px;background:#09090b">
  <div class="page">
    <section class="card">${ticks}
      ${secHead(3)}
      <div class="phase">
        ${phaseHead("Offer", "3 jobs · ฿22,300 proposed")}
        ${offerHeadRow()}
        ${offerRow(false, "Left-side repaint", "", "Customer pays", plainPrice("฿12,000"))}
        ${offerRow(false, "Brake pads", "catalog", "Customer pays", lockedPrice("฿3,500"))}
        ${offerRow(false, "Rear glass", "", "Customer pays", plainPrice("฿6,800"))}
        <div class="foot">${btn("outline", "Add job", "plus")}<span class="t11 muted" style="margin-left:auto"><span class="mono primary" style="font-size:12px;font-weight:600">Q-1031</span> · Sep 2</span>${btn("primary", "Record response")}</div>
      </div>
    </section>
  </div>
  <div class="veil"></div>
  <div class="center">
    <div class="dlg" style="width:560px">${ticks}
      <div class="dlg-head"><span class="h3">Record the customer's response</span><span class="faint" style="margin-left:auto">${ic("x", 14)}</span></div>
      <div class="dlg-body">
        <div class="line"><span class="lab">Answered via</span>${seg([["LINE", "on"], ["Phone"], ["In person"], ["Other"]])}</div>
        <div class="line"><span class="lab">Quotation shown</span>${sel("Q-1031 · Sep 2", "width:180px")}</div>
        <div style="border:1px solid #26262a">
          <div class="lrow" style="min-height:30px;border-top:0"><span class="t10 faint" style="flex:1">3 jobs · ฿22,300</span>${quiet("All yes")}</div>
          ${respRow("Left-side repaint", "฿12,000", true)}
          ${respRow("Brake pads", "฿3,500", true)}
          ${respRow("Rear glass", "฿6,800", false)}
        </div>
        <div class="line"><span class="lab">Note</span><span class="field" style="flex:1">ราคากระจกสูงไป — ไว้คราวหน้า</span></div>
      </div>
      <div class="dlg-foot"><span class="t11 muted"><span class="ok">2 authorized</span> · <span class="bad">1 declined</span></span><span style="margin-left:auto;display:inline-flex;gap:8px">${btn("primary", "Save 3 decisions")}${btn("ghost", "Cancel")}</span></div>
    </div>
  </div>
</div>`);

/* =================== 3 · Work =================== */
const workRow = (open, title, chipCls, chipText, tech, price) =>
  `<div class="row">${ic(open ? "chevD" : "chevR", 14, "chev")}<span class="title">${title}</span>${chip(chipCls, chipText)}<span class="t11 faint" style="width:96px;flex:none;text-align:right">${tech}</span><span class="num t13" style="width:88px;flex:none;text-align:right">${price}</span></div>`;
const techLine = (techHtml, price, moreBtn = true) =>
  `<div class="line"><span class="t11 faint">Technician</span>${techHtml}<span class="num t13" style="margin-left:4px">${price}</span><span class="t11 muted">Customer pays</span>${moreBtn ? `<span class="sel" style="margin-left:auto;width:28px;padding:0;justify-content:center;color:#a1a1aa">${ic("more", 14)}</span>` : ""}</div>`;
const doneRowDeclined = () =>
  `<div class="row">${ic("chevR", 14, "chev")}<span class="title" style="color:#a1a1aa">Rear glass</span>${chip("c-declined", "DECLINED")}<span class="t11 muted" style="flex:2;min-width:0;text-align:right">Sep 2 · LINE — “ราคากระจกสูงไป — ไว้คราวหน้า”</span><span class="num t13 faint" style="width:88px;flex:none;text-align:right">฿6,800</span></div>`;

files["Work.dc.html"] = doc(`
<div class="page">
  <section class="card">${ticks}
    ${secHead(3)}
    <div class="phase">
      ${phaseHead("Work", "2 jobs · 2 authorized, not started")}
      ${workRow(true, "Left-side repaint", "c-authorized", "AUTHORIZED", "Unassigned", "฿12,000")}
      <div class="body">
        ${techLine(sel("Unassigned", "width:150px;border-color:rgba(245,166,35,.5);color:#f5a623"), "฿12,000")}
        ${partsTable([
          { name: "Door skin FL", qty: 1, cost: "2,800", sup: "Toyota TPS", eta: "Sep 5", status: "Ordered", tone: TONE.ordered },
          { name: "Primer set", note: "2K", qty: 1, cost: "1,400", status: "Not ordered", tone: TONE.none },
        ])}
        <div style="display:flex;gap:6px;align-items:center">${thumbs(1)}${addPhoto()}</div>
        <div class="act">${btn("primary", "Start work", "play")}${btn("outline", "Waiting…", "clock")}</div>
        <span class="prov">Authorized Sep 2 · LINE · Q-1031 · สมชาย ใจดี</span>
      </div>
      ${workRow(false, "Brake pads", "c-authorized", "AUTHORIZED", "Unassigned", "฿3,500")}
    </div>
    <div class="phase">
      ${phaseHead("Done", "1 declined")}
      ${doneRowDeclined()}
    </div>
  </section>
</div>`);

/* =================== 4 · Waiting and QC =================== */
files["WaitingQc.dc.html"] = doc(`
<div class="page">
  <section class="card">${ticks}
    ${secHead(3)}
    <div class="phase">
      ${phaseHead("Work", `2 jobs · <span class="warn">1 waiting — parts</span> · <span class="info">1 in QC</span>`)}
      ${workRow(true, "Left-side repaint", "c-waiting", "WAITING · PARTS", "ช่างต้น", "฿12,000")}
      <div class="body">
        <span class="t12 warn" style="display:inline-flex;align-items:center;gap:6px">${ic("clock", 14)}1 of 2 parts arrived · door skin due Sep 5</span>
        ${techLine(sel("ช่างต้น", "width:150px"), "฿12,000")}
        ${partsTable([
          { name: "Door skin FL", qty: 1, cost: "2,800", sup: "Toyota TPS", eta: "Sep 5", status: "Ordered", tone: TONE.ordered },
          { name: "Primer set", note: "2K", qty: 1, cost: "1,400", sup: "ร้านสีสมชาย", eta: "Sep 3", status: "Arrived", tone: TONE.arrived },
        ])}
        <div style="display:flex;gap:6px;align-items:center">${thumbs(2)}${addPhoto()}</div>
        <div class="act">${btn("primary", "Resume work", "play")}${btn("outline", "Change reason…", "clock")}</div>
        <span class="prov">Waiting since Sep 3 · Authorized Sep 2 · LINE · Q-1031</span>
      </div>
      ${workRow(true, "Brake pads", "c-qc", "IN QC", "ช่างบอย", "฿3,500")}
      <div class="body">
        ${techLine(sel("ช่างบอย", "width:150px"), "฿3,500")}
        <div style="display:flex;gap:6px;align-items:center">${thumbs(3)}${addPhoto()}</div>
        <div class="act">${btn("primary", "QC pass", "shieldCheck")}${btn("bad", "QC fail…", "shieldX")}<span class="hint" style="margin-left:auto">Manager signs off — never the technician who did the work</span></div>
        <span class="prov">Sent to QC Sep 4 · In progress since Sep 3 · Authorized Sep 2</span>
      </div>
    </div>
    <div class="phase">
      ${phaseHead("Done", "1 declined")}
      ${doneRowDeclined()}
    </div>
  </section>
</div>`);

/* =================== 5 · Delivered =================== */
files["Delivered.dc.html"] = doc(`
<div class="page">
  <section class="card">${ticks}
    ${secHead(3, "Delivered Sep 6 · closed record")}
    <div class="phase">
      ${workRow(true, "Left-side repaint", "c-completed", "COMPLETED", "ช่างต้น", "฿12,000")}
      <div class="detail">
        <span style="display:inline-flex;align-items:center;gap:6px"><span class="faint">Fulfils</span><span class="fchip">front-left door</span><span class="fchip">rear-left door</span></span>
        <span class="num">2 parts · ฿4,200 cost</span>
        <span style="display:inline-flex;gap:4px">${thumbs(3)}</span>
        <span class="faint" style="flex-basis:100%">QC passed Sep 5 · ผู้จัดการ · Authorized Sep 2 · LINE · Q-1031</span>
      </div>
      ${workRow(false, "Brake pads", "c-completed", "COMPLETED", "ช่างบอย", "฿3,500")}
      ${doneRowDeclined()}
    </div>
  </section>
</div>`);

/* =================== Popups =================== */
files["Popups.dc.html"] = doc(`
<div style="width:768px;padding:16px;display:flex;align-items:flex-start;gap:28px">
  <div class="menu">
    <div>${ic("pencil")}Edit details</div>
    <div>${ic("plus")}Add part</div>
    <div>${ic("camera")}Add photo</div>
    <div class="sep"></div>
    <div class="bad">${ic("ban")}Cancel job…</div>
    <div class="sep"></div>
    <div class="faint">${ic("undo")}Revert step</div>
    <div class="faint">${ic("undo")}Revert to proposed</div>
  </div>
  <div class="dlg" style="width:250px">${ticks}
    <div class="dlg-head" style="padding:10px 14px"><span class="t12" style="font-weight:500">Waiting for</span></div>
    <div class="dlg-body" style="padding:12px 14px;gap:8px">
      ${seg([["Parts", "on"]], "sm")}
      <div style="display:flex;gap:6px;flex-wrap:wrap">${seg([["Paint booth"]], "sm")}${seg([["Technician"]], "sm")}${seg([["Other"]], "sm")}</div>
    </div>
    <div class="dlg-foot" style="padding:10px 14px">${btn("primary", "Confirm")}${btn("ghost", "Cancel")}</div>
  </div>
  <div class="dlg" style="width:300px">${ticks}
    <div class="dlg-head" style="padding:10px 14px"><span class="h3">QC failed</span></div>
    <div class="dlg-body" style="padding:12px 14px;gap:8px">
      <span class="field" style="height:64px;align-items:flex-start;padding-top:6px">สีไม่ตรง — ต้องพ่นใหม่ทั้งบาน</span>
      <span class="hint">Required. Goes to the internal timeline only — never to the customer.</span>
    </div>
    <div class="dlg-foot" style="padding:10px 14px">${btn("bad", "Send back to work", "shieldX")}${btn("ghost", "Cancel")}</div>
  </div>
</div>`);


/* =================== Collapsed · accept fills the offer =================== */
const tile = (zone, note, what, jobTitle) =>
  `<div class="tile"><span class="sev"></span>
    <div style="display:flex;align-items:center;gap:8px"><span class="t12" style="font-weight:500;flex:1">${zone}</span><span class="fchip">${jobTitle}</span></div>
    <div style="display:flex;align-items:center;gap:8px"><span class="tthumb"></span><span style="display:flex;flex-direction:column;line-height:1.3"><span class="t12">${note}</span><span class="t11 muted">${what}</span></span></div>
  </div>`;
files["Collapsed.dc.html"] = doc(`
<div style="position:relative;width:1240px;height:600px;background:#09090b">
  <section class="card" style="position:absolute;left:16px;top:16px;width:580px;box-sizing:border-box;padding-bottom:12px">${ticks}
    <div class="sec-head" style="height:38px;box-sizing:border-box;align-items:center;padding:0 20px"><span class="h3">Inspection</span></div>
    <div class="ph-head" style="height:30px;box-sizing:border-box;align-items:center;padding:0 16px"><span class="ph-title">Damage findings</span><span class="ph-sub num">3</span></div>
    ${tile("Front-left door", "รอยบุบกลางบาน", "dent · repair + repaint", "Left-side repaint")}
    ${tile("Rear-left door", "รอยขีดยาว", "scratch · repaint", "Left-side repaint")}
    ${tile("Hood", "บุบขอบหน้า", "dent · repaint", "Hood")}
    <div class="ph-head" style="height:30px;box-sizing:border-box;align-items:center;padding:0 16px;margin-top:8px"><span class="ph-title">Service checklist</span></div>
    <div class="row" style="height:40px;padding:0 16px;box-sizing:border-box"><span class="title">Brakes</span>${seg([["OK"], ["Due soon"], ["Needs work", "amb"]], "sm")}</div>
    <div style="height:80px;box-sizing:border-box;padding:8px 16px 0 16px;display:flex;flex-direction:column;gap:12px;background:rgba(22,22,24,.5)">
      <div class="line" style="height:26px"><span class="lab" style="width:36px">Fix</span>${seg([["Repair"], ["Replace", "on"], ["Service"]], "sm")}</div>
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;height:28px">${quiet("Discard")}${btn("primary", "Accept", "check")}</div>
    </div>
  </section>

  <section class="card" style="position:absolute;left:660px;top:58px;width:564px;box-sizing:border-box">${ticks}
    <div class="sec-head" style="height:38px;box-sizing:border-box;align-items:center"><span class="h3">Jobs</span><span class="num t11 faint">2</span></div>
    <div class="ph-head" style="height:30px;box-sizing:border-box;align-items:center"><span class="ph-title">Offer</span><span class="ph-sub">2 jobs · ฿12,000 proposed · <span class="warn">1 unpriced</span></span></div>
    ${offerHeadRow()}
    ${offerRow(false, "Left-side repaint", "", "Customer pays", livePrice("12,000")).replace('<span class="title">', '<span class="title">').replace("Left-side repaint</span>", 'Left-side repaint <span class="t11 faint" style="font-weight:400">· 2 findings</span></span>')}
    ${offerRow(false, "Hood", "", "Customer pays", emptyPrice())}
    <div class="row" style="height:40px">${ic("chevR", 14, "chev")}<span class="title faint" style="font-weight:400">Brakes</span><span style="width:110px;flex:none"></span><span class="pcell empty" style="border-color:#3b3b41;color:#6b6b74">price</span></div>
    <div class="foot" style="height:48px;box-sizing:border-box">${btn("outline", "Add job", "plus")}<span class="t11 faint" style="margin-left:auto">Not sent</span>${btn("primary", "Send quotation")}</div>
  </section>

  <svg style="position:absolute;left:0;top:0" width="1240" height="600" viewBox="0 0 1240 600" fill="none" aria-hidden="true">
    <defs>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6b6b74"></path></marker>
      <marker id="ahp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#f97316"></path></marker>
    </defs>
    <path d="M598,128 C630,128 628,168 658,168" stroke="#6b6b74" stroke-width="1.25" marker-end="url(#ah)"></path>
    <path d="M598,208 C630,208 628,168 658,168" stroke="#6b6b74" stroke-width="1.25"></path>
    <path d="M598,288 C630,288 628,208 658,208" stroke="#6b6b74" stroke-width="1.25" marker-end="url(#ah)"></path>
    <path d="M598,462 C632,462 626,248 658,248" stroke="#f97316" stroke-width="1.25" stroke-dasharray="4 4" marker-end="url(#ahp)"></path>
    <text x="628" y="176" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="11" fill="#a1a1aa">merge</text>
    <text x="616" y="285" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="11" fill="#f97316">accept</text>
  </svg>
</div>`);

/* =================== canvas.json =================== */
const canvas = {
  artboards: [
    { file: "Main.dc.html", title: "1 · Building the offer", x: 0, y: 0, w: 800, h: 360 },
    { file: "AddJob.dc.html", title: "Add job", x: 900, y: 0, w: 800, h: 560 },
    { file: "AwaitingAuth.dc.html", title: "2 · Awaiting authorization", x: 1800, y: 0, w: 800, h: 300 },
    { file: "RecordResponse.dc.html", title: "Record response", x: 2700, y: 0, w: 800, h: 640 },
    { file: "Work.dc.html", title: "3 · Work", x: 0, y: 840, w: 800, h: 480 },
    { file: "WaitingQc.dc.html", title: "4 · Waiting and QC", x: 900, y: 840, w: 800, h: 720 },
    { file: "Delivered.dc.html", title: "5 · Delivered", x: 1800, y: 840, w: 800, h: 300 },
    { file: "Popups.dc.html", title: "Popups", x: 2700, y: 840, w: 800, h: 300 },
    { file: "Collapsed.dc.html", title: "Collapsed · accept fills the offer", x: 0, y: 1720, w: 1240, h: 600 },
  ],
  annotations: [
    { id: "n-offer", x: 0, y: -170, w: 360, text: "1 · Building the offer. The Offer is the one part of the page that is a form: the price cell is live, everything else sits under the expanded row behind Edit. Only one phase has members, so no phase headings yet. The header's primary (Set prices) scrolls here and focuses the first empty cell." },
    { id: "n-addjob", x: 900, y: -170, w: 360, text: "Add job replaces the two source-named buttons. One dialog, three sources. 'From findings' shows only while ungrouped findings exist, and the header's 'Group into jobs' opens the dialog straight there. 'Add and another' keeps the multi-add rhythm." },
    { id: "n-await", x: 1800, y: -170, w: 360, text: "2 · Awaiting authorization. The foot of the Offer carries the set-level tooling: the quotation lineage and one primary action. The header's primary opens the same dialog. Mixed payers (not drawn): rows group by payer and a response records one payer at a time." },
    { id: "n-response", x: 2700, y: -170, w: 360, text: "Record response (D-20): channel, quotation and note once; a Yes/No on every job; one save. Yes rows move to Work, No rows to Done. An unpriced row can only be declined and says so." },
    { id: "n-work", x: 0, y: 690, w: 360, text: "3 · Work. Each card leads with exactly one primary next step. Technician is a live field (assigning is an everyday act, not an edit) and lights amber while unassigned. Corrections — cancel, revert — move into the ⋯ menu. Done shows the declined job as one line." },
    { id: "n-waiting", x: 900, y: 690, w: 360, text: "4 · Waiting and QC. A waiting card puts the blocker first, the parts table under it, and arrival stays one tap. QC pass is the Manager's primary; an advisor sees the hint and no pass button." },
    { id: "n-done", x: 1800, y: 690, w: 360, text: "5 · Delivered. One phase left, so no heading: the section reads as a closed record. Completed rows are receipts — fulfils, parts cost, photos, QC and authorization provenance." },
    { id: "n-collapsed", x: 0, y: 1590, w: 420, text: "Collapsed flow. Accept puts a line in the Offer. Merge joins panels into one job. Send quotation stamps the version." },
    { id: "n-popups", x: 2700, y: 690, w: 360, text: "The small popups: the ⋯ menu (Manager-only items shown faint), Set waiting, and QC fail. Cancel job has the same shape as QC fail with a required reason." },
  ],
  launch: { view: "canvas" },
};

for (const [name, html] of Object.entries(files)) writeFileSync(join(OUT, name), html);
writeFileSync(join(OUT, "canvas.json"), JSON.stringify(canvas, null, 2));
console.log("wrote", Object.keys(files).length, "artboards");
