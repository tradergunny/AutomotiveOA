"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { cn } from "@/lib/utils";

/**
 * The small dialog the Jobs flow uses for the interruptions that need input
 * (D-22, D-23): Add job, Send quotation, Record response, Set waiting, QC
 * fail, Cancel job. Radix for focus and escape; the skin is the house one —
 * sharp geometry, a strong border, corner ticks, dashed seams — not shadcn's
 * rounded default. A dialog is a card that happens to float.
 */

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  title,
  description,
  width = "md",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: React.ReactNode;
  /** Screen-reader description — visible copy belongs in the body. */
  description?: string;
  width?: "sm" | "md" | "lg";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-background/75 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col border border-border-strong bg-popover text-popover-foreground shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          width === "sm" && "max-w-xs",
          width === "md" && "max-w-lg",
          width === "lg" && "max-w-2xl",
          className,
        )}
        {...props}
      >
        <CornerTicks />
        <header className="flex items-center gap-3 border-b border-dashed px-4 py-3 sm:px-5">
          <DialogPrimitive.Title className="text-[13px] font-semibold">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
          ) : null}
          <DialogPrimitive.Close
            className="ml-auto flex size-7 items-center justify-center text-faint hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            aria-label="Close"
          >
            <X className="size-3.5" aria-hidden />
          </DialogPrimitive.Close>
        </header>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5 sm:px-5", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return (
    <footer
      className={cn("flex flex-wrap items-center gap-2 border-t border-dashed px-4 py-3 sm:px-5", className)}
      {...props}
    />
  );
}

/** A quiet label column beside a control ("Answered via", "Quotation shown"). */
function DialogRow({
  label,
  className,
  children,
}: {
  label: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      <span className="w-28 shrink-0 text-[11px] text-faint">{label}</span>
      {children}
    </div>
  );
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogBody, DialogFooter, DialogRow };
