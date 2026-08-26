"use client";

import { Pencil, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBaht, satangToBahtInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  createCatalogItem,
  setCatalogItemActive,
  updateCatalogItem,
  type CatalogError,
  type CatalogItemDto,
} from "./actions";

/**
 * Service Catalog screen (M4 brief §2). Managers maintain the list; Advisors
 * see it read-only (they pick entries in the Job builder). Client state holds
 * the items and reconciles with what each server action returns, M3-style.
 */

function ItemFields({ item }: { item?: CatalogItemDto }) {
  const t = useTranslations("catalog");
  return (
    <>
      <Input
        name="name"
        defaultValue={item?.name ?? ""}
        placeholder={t("namePlaceholder")}
        required
        className="min-w-0 flex-[2]"
      />
      <Input
        name="price"
        defaultValue={item ? satangToBahtInput(item.priceSatang) : ""}
        placeholder={t("pricePlaceholder")}
        inputMode="decimal"
        required
        className="num w-28 flex-none text-right"
      />
      <Input
        name="note"
        defaultValue={item?.note ?? ""}
        placeholder={t("notePlaceholder")}
        className="min-w-0 flex-1"
      />
    </>
  );
}

export function CatalogTable({
  initialItems,
  readOnly,
}: {
  initialItems: CatalogItemDto[];
  readOnly: boolean;
}) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const [items, setItems] = useState(initialItems);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<CatalogError | null>(null);
  const [pending, setPending] = useState(false);
  const createFormRef = useRef<HTMLFormElement>(null);

  const sorted = [...items].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "th"),
  );

  async function run(action: () => Promise<Awaited<ReturnType<typeof createCatalogItem>>>) {
    setPending(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      return res.value;
    } finally {
      setPending(false);
    }
  }

  async function handleCreate(formData: FormData) {
    const item = await run(() => createCatalogItem(formData));
    if (!item) return;
    setItems((list) => [...list, item]);
    createFormRef.current?.reset();
  }

  async function handleUpdate(itemId: string, formData: FormData) {
    const item = await run(() => updateCatalogItem(itemId, formData));
    if (!item) return;
    setItems((list) => list.map((x) => (x.id === item.id ? item : x)));
    setEditing(null);
  }

  async function handleToggle(item: CatalogItemDto) {
    const updated = await run(() => setCatalogItemActive(item.id, !item.active));
    if (!updated) return;
    setItems((list) => list.map((x) => (x.id === updated.id ? updated : x)));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="relative border bg-card">
        <CornerTicks />
        <header className="flex items-center gap-2.5 border-b border-dashed px-3.5 py-2.5">
          <h2 className="text-[12.5px] font-semibold tracking-wide">{t("title")}</h2>
          <span className="num ml-auto border border-border-strong px-1.5 text-[10.5px] text-primary">
            {items.length}
          </span>
        </header>

        {sorted.length === 0 ? (
          <p className="px-3.5 py-4 text-xs text-faint">
            {readOnly ? t("emptyReadOnly") : t("empty")}
          </p>
        ) : (
          <ul>
            {sorted.map((item) =>
              editing === item.id ? (
                <li key={item.id} className="border-b px-3.5 py-2.5 last:border-b-0">
                  <form
                    action={(formData) => void handleUpdate(item.id, formData)}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <ItemFields item={item} />
                    <Button type="submit" size="sm" disabled={pending} className="font-semibold">
                      {pending ? tc("saving") : tc("save")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {tc("cancel")}
                    </Button>
                  </form>
                </li>
              ) : (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-center gap-3 border-b px-3.5 py-2 last:border-b-0",
                    !item.active && "opacity-50",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {item.name}
                    {item.note && (
                      <span className="ml-2 text-xs text-muted-foreground">· {item.note}</span>
                    )}
                  </span>
                  {!item.active && (
                    <span className="border border-border-strong px-1.5 py-px font-mono text-[9px] tracking-wider text-faint">
                      {t("inactive")}
                    </span>
                  )}
                  <span className="num text-[13px]">{formatBaht(item.priceSatang)}</span>
                  {!readOnly && (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(item.id)}
                        className="p-1 text-faint hover:text-foreground"
                        aria-label={tc("edit")}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggle(item)}
                        disabled={pending}
                        className="p-1 text-faint hover:text-bad"
                        aria-label={item.active ? t("deactivate") : t("reactivate")}
                        title={item.active ? t("deactivate") : t("reactivate")}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      {!readOnly && (
        <form
          ref={createFormRef}
          action={(formData) => void handleCreate(formData)}
          className="flex flex-wrap items-center gap-2 border border-dashed bg-card/50 p-3"
        >
          <span className="eyebrow flex w-full items-center gap-1.5">
            <Plus className="size-3" aria-hidden />
            {t("addTitle")}
          </span>
          <ItemFields />
          <Button type="submit" size="sm" disabled={pending} className="font-semibold">
            {pending ? tc("saving") : t("add")}
          </Button>
        </form>
      )}

      {readOnly && <p className="text-xs text-faint">{t("managerOnlyHint")}</p>}

      {error && (
        <p role="alert" className="border border-bad/45 px-3 py-2 text-xs text-bad">
          {t(`errors.${error}`)}
        </p>
      )}
    </div>
  );
}
