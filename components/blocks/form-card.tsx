import type { ReactNode } from "react";
import { CornerTicks } from "@/components/blocks/corner-ticks";

/** Bordered center card hosting one form, in the technical aesthetic. */
export function FormCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative mx-auto mt-6 w-full max-w-lg border bg-card p-6">
      <CornerTicks />
      <h2 className="mb-5 text-[15px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}
