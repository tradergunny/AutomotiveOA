"use client";

import { Camera, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { jobEvidence } from "@/lib/job-review";
import type { JobDto } from "@/lib/jobs";

export function JobEvidence({ job }: { job: JobDto }) {
  const t = useTranslations("jobs.review");
  const photos = jobEvidence(job);
  const [index, setIndex] = useState<number | null>(null);
  const active = index == null ? null : photos[Math.min(index, photos.length - 1)];
  if (photos.length === 0) return (
    <div className="flex h-20 w-full flex-col items-center justify-center gap-1 border border-dashed bg-surface-2 text-muted-foreground">
      <Camera className="size-5" aria-hidden />
      <span className="text-[11px]">{t("noPhotos")}</span>
    </div>
  );
  return (
    <>
      <button type="button" onClick={() => setIndex(0)} aria-label={t("viewPhotos", { title: job.title, count: photos.length })} className="group relative block h-20 w-full overflow-hidden border focus-visible:outline-2 focus-visible:outline-primary sm:h-24">
        {/* eslint-disable-next-line @next/next/no-img-element -- tenant-authenticated image route */}
        <img src={`/api/photos/${photos[0]!.id}`} alt={t("evidenceAlt", { title: job.title, n: 1 })} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
        <span className="absolute right-1 bottom-1 border bg-background/95 px-1.5 py-0.5 text-[10px] text-foreground">{t("photoCount", { count: photos.length })}</span>
      </button>
      <Dialog open={!!active} onOpenChange={(open) => !open && setIndex(null)}>
        {active && <DialogContent title={job.title} description={t("photoDescription")} width="lg">
          <DialogBody>
            {/* eslint-disable-next-line @next/next/no-img-element -- tenant-authenticated image route */}
            <img src={`/api/photos/${active.id}`} alt={t("evidenceAlt", { title: job.title, n: (index ?? 0) + 1 })} className="max-h-[60dvh] w-full object-contain" />
          </DialogBody>
          <DialogFooter className="justify-between">
            <Button variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, (value ?? 0) - 1))}><ChevronLeft aria-hidden />{t("previousPhoto")}</Button>
            <span aria-live="polite" className="text-xs text-muted-foreground">{t("photoPosition", { n: (index ?? 0) + 1, count: photos.length })}</span>
            <Button variant="outline" size="sm" disabled={(index ?? 0) >= photos.length - 1} onClick={() => setIndex((value) => Math.min(photos.length - 1, (value ?? 0) + 1))}>{t("nextPhoto")}<ChevronRight aria-hidden /></Button>
          </DialogFooter>
        </DialogContent>}
      </Dialog>
    </>
  );
}
