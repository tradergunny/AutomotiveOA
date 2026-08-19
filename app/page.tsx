import { CornerTicks } from "@/components/blocks/corner-ticks";

// Placeholder proving the theme tokens — replaced by the app shell in M1 step 7.
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="relative border bg-card px-10 py-8 text-center">
        <CornerTicks />
        <div className="font-mono text-lg font-semibold tracking-widest">
          AUTOMOTIVE<span className="text-primary">OA</span>
        </div>
        <div className="eyebrow mt-2">Workshop OS</div>
        <div className="mt-6 flex items-center justify-center gap-2 border-t border-dashed pt-4">
          <span className="border border-ok/40 px-2 py-0.5 text-[11px] text-ok">OK</span>
          <span className="border border-warn/40 px-2 py-0.5 text-[11px] text-warn hatch-soft">WAIT</span>
          <span className="border border-bad/40 px-2 py-0.5 text-[11px] text-bad">QC FAIL</span>
          <span className="border border-info/40 px-2 py-0.5 text-[11px] text-info">ACTIVE</span>
          <span className="num border border-border-strong px-2 py-0.5 text-[11px] text-muted-foreground">฿12,500</span>
        </div>
      </div>
    </main>
  );
}
