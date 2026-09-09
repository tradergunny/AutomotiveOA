import { cn } from "@/lib/utils";

/**
 * A make's mark in a circle (D-28): a self-hosted SVG from public/brands/
 * for the makes the shop sees, else a two-letter monogram of the make. The
 * logo set is an asset the founder supplies — the list below is what ships;
 * add a file and its slug here to light it up. Never a fetched or
 * third-party logo (D-5's no-external-art rule, applied to marks).
 */
const LOGOS: Record<string, string> = {
  // "toyota": "/brands/toyota.svg",
};

function slugOf(make: string): string {
  return make.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function monogram(make: string | null): string {
  if (!make) return "—";
  const words = make.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toLocaleUpperCase();
  return make.trim().slice(0, 2).toLocaleUpperCase();
}

export function BrandMark({
  make,
  size = 40,
  className,
}: {
  make: string | null;
  size?: number;
  className?: string;
}) {
  const logo = make ? LOGOS[slugOf(make)] : undefined;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "grid flex-none place-items-center overflow-hidden rounded-full border bg-surface-2 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground",
        className,
      )}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- static in-repo asset
        <img src={logo} alt="" width={size * 0.6} height={size * 0.6} />
      ) : (
        monogram(make)
      )}
    </span>
  );
}
