"use client";

import { Camera, Car, Phone, Search, Truck, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { CornerTicks } from "@/components/blocks/corner-ticks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPhone } from "@/lib/normalize";
import {
  addCasePhoto,
  type CheckinState,
  type LookupCustomer,
  type LookupVehicle,
  lookupCheckinCustomer,
  lookupCheckinVehicle,
  performCheckin,
} from "./actions";
import { downscalePhoto } from "@/lib/downscale";

type ContactState =
  | { mode: "idle" }
  | { mode: "found"; customer: LookupCustomer }
  | { mode: "new" };

type VehicleState =
  | { mode: "idle" }
  | { mode: "found"; vehicle: LookupVehicle }
  | { mode: "new" };

type PendingPhoto = { id: string; blob: Blob; url: string };

const BODY_TYPES = [
  { value: "SEDAN", icon: Car },
  { value: "PICKUP", icon: Truck },
] as const;

function SectionHeader({ index, icon: Icon, label }: { index: string; icon: typeof Car; label: string }) {
  return (
    <h3 className="eyebrow flex items-center gap-1.5">
      <span className="text-primary">{index}</span>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </h3>
  );
}

export function CheckinWizard() {
  const t = useTranslations("checkin");
  const tCust = useTranslations("customers");
  const tVeh = useTranslations("vehicles");

  const [contact, setContact] = useState<ContactState>({ mode: "idle" });
  const [vehicle, setVehicle] = useState<VehicleState>({ mode: "idle" });
  const [contactName, setContactName] = useState("");
  const [phoneLooking, setPhoneLooking] = useState(false);
  const [plateLooking, setPlateLooking] = useState(false);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState<CheckinState["error"]>();

  const phoneRef = useRef<HTMLInputElement>(null);
  const plateRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadStarted = useRef(false);
  const router = useRouter();
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);

  const [state, dispatch, pending] = useActionState(performCheckin, {});
  const [, startTransition] = useTransition();

  // Case committed → push the walkaround shots one request each (Vercel's
  // serverless body cap rules out one big multipart), then land on the case.
  // A shot that fails twice is skipped rather than stranding the check-in —
  // the case page shows what made it.
  useEffect(() => {
    const caseId = state.caseId;
    if (!caseId || uploadStarted.current) return;
    uploadStarted.current = true;
    void (async () => {
      setUploading({ done: 0, total: photos.length });
      for (let i = 0; i < photos.length; i++) {
        const formData = new FormData();
        formData.append("photo", photos[i].blob, "walkaround.jpg");
        const first = await addCasePhoto(caseId, formData);
        if (!first.ok) await addCasePhoto(caseId, formData);
        setUploading({ done: i + 1, total: photos.length });
      }
      router.push(`/cases/${caseId}`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on the success transition
  }, [state.caseId]);

  async function lookupPhone() {
    const raw = phoneRef.current?.value.trim() ?? "";
    if (!raw) return;
    setPhoneLooking(true);
    try {
      const { customer } = await lookupCheckinCustomer(raw);
      setContact(customer ? { mode: "found", customer } : { mode: "new" });
      setLocalError(undefined);
    } finally {
      setPhoneLooking(false);
    }
  }

  async function lookupPlate() {
    const raw = plateRef.current?.value.trim() ?? "";
    if (!raw) return;
    setPlateLooking(true);
    try {
      const { vehicle: found } = await lookupCheckinVehicle(raw);
      setVehicle(found ? { mode: "found", vehicle: found } : { mode: "new" });
      setLocalError(undefined);
    } finally {
      setPlateLooking(false);
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setProcessing(true);
    try {
      const added: PendingPhoto[] = [];
      for (const file of Array.from(list)) {
        const blob = await downscalePhoto(file);
        added.push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
      }
      setPhotos((current) => [...current, ...added]);
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const photo = current.find((p) => p.id === id);
      if (photo) URL.revokeObjectURL(photo.url);
      return current.filter((p) => p.id !== id);
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (contact.mode === "idle") {
      setLocalError("contactRequired");
      return;
    }
    if (vehicle.mode === "idle") {
      setLocalError("vehicleRequired");
      return;
    }
    setLocalError(undefined);
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  const contactLabel =
    contact.mode === "found" ? contact.customer.name : contactName || "—";
  const showOwnership =
    vehicle.mode === "found" &&
    (contact.mode === "new" ||
      (contact.mode === "found" &&
        contact.customer.id !== vehicle.vehicle.primaryCustomer.id));
  const error = localError ?? state.error;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* 01 — contact */}
      <section className="relative border bg-card p-4">
        <CornerTicks />
        <SectionHeader index="01" icon={User} label={t("contactSection")} />
        <div className="mt-3 flex gap-2">
          <div className="relative w-full max-w-60">
            <Phone className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <Input
              ref={phoneRef}
              name="phone"
              type="tel"
              inputMode="tel"
              className="num pl-8"
              placeholder={tCust("phone")}
              required={contact.mode !== "found"}
              onChange={() => contact.mode !== "idle" && setContact({ mode: "idle" })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void lookupPhone();
                }
              }}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => void lookupPhone()} disabled={phoneLooking}>
            <Search data-icon="inline-start" />
            {phoneLooking ? t("looking") : t("lookup")}
          </Button>
        </div>

        {contact.mode === "found" && (
          <div className="mt-3 flex items-center gap-2.5 border border-ok/40 bg-ok/5 px-3 py-2">
            <input type="hidden" name="contactCustomerId" value={contact.customer.id} />
            <span className="eyebrow text-ok">{t("foundCustomer")}</span>
            <span className="text-sm font-medium">{contact.customer.name}</span>
            {contact.customer.company && (
              <span className="text-xs text-muted-foreground">· {contact.customer.company}</span>
            )}
            <span className="num text-xs text-muted-foreground">
              {formatPhone(contact.customer.phone)}
            </span>
            <button
              type="button"
              onClick={() => setContact({ mode: "idle" })}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              {t("change")}
            </button>
          </div>
        )}

        {contact.mode === "new" && (
          <div className="mt-3 flex flex-col gap-3 border border-dashed p-3">
            <p className="text-xs text-warn">{t("newCustomerHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="checkin-name">{tCust("name")}</Label>
                <Input
                  id="checkin-name"
                  name="name"
                  required
                  autoFocus
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="checkin-company">{tCust("company")}</Label>
                <Input id="checkin-company" name="company" placeholder={tCust("companyHint")} />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 02 — vehicle */}
      <section className="relative border bg-card p-4">
        <SectionHeader index="02" icon={Car} label={t("vehicleSection")} />
        <div className="mt-3 flex gap-2">
          <Input
            ref={plateRef}
            name="plate"
            className="w-full max-w-60 font-mono"
            placeholder={tVeh("plate")}
            required={vehicle.mode !== "found"}
            onChange={() => vehicle.mode !== "idle" && setVehicle({ mode: "idle" })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void lookupPlate();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={() => void lookupPlate()} disabled={plateLooking}>
            <Search data-icon="inline-start" />
            {plateLooking ? t("looking") : t("lookup")}
          </Button>
        </div>

        {vehicle.mode === "found" && (
          <div className="mt-3 flex flex-wrap items-center gap-2.5 border border-ok/40 bg-ok/5 px-3 py-2">
            <input type="hidden" name="vehicleId" value={vehicle.vehicle.id} />
            <span className="eyebrow text-ok">{t("foundVehicle")}</span>
            <span className="border border-border-strong px-1.5 py-px font-mono text-[13px]">
              {vehicle.vehicle.plate}
            </span>
            <span className="text-xs text-muted-foreground">
              {tVeh(`bodyTypes.${vehicle.vehicle.bodyType}`)}
              {[vehicle.vehicle.make, vehicle.vehicle.model, vehicle.vehicle.color]
                .filter(Boolean)
                .map((part) => ` · ${part}`)
                .join("")}
            </span>
            <span className="text-xs text-muted-foreground">
              {tVeh("owner")}: {vehicle.vehicle.primaryCustomer.name}
            </span>
            <button
              type="button"
              onClick={() => setVehicle({ mode: "idle" })}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              {t("change")}
            </button>
          </div>
        )}

        {vehicle.mode === "new" && (
          <div className="mt-3 flex flex-col gap-3 border border-dashed p-3">
            <p className="text-xs text-warn">{t("newVehicleHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="checkin-province">{tVeh("province")}</Label>
                <Input id="checkin-province" name="province" />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm leading-none font-medium">{tVeh("bodyType")}</span>
                <div className="grid grid-cols-2 gap-2">
                  {BODY_TYPES.map(({ value, icon: Icon }) => (
                    <label
                      key={value}
                      className="flex h-8 cursor-pointer items-center justify-center gap-1.5 border text-sm text-muted-foreground transition-colors hover:bg-surface-2 has-checked:border-primary has-checked:bg-primary-soft has-checked:text-foreground"
                    >
                      <input type="radio" name="bodyType" value={value} required className="sr-only" />
                      <Icon className="size-4" aria-hidden />
                      {tVeh(`bodyTypes.${value}`)}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(["make", "model", "color"] as const).map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <Label htmlFor={`checkin-${field}`}>{tVeh(field)}</Label>
                  <Input id={`checkin-${field}`} name={field} />
                </div>
              ))}
            </div>
          </div>
        )}

        {showOwnership && (
          <fieldset className="mt-3 flex flex-col gap-1.5 border border-warn/40 p-3">
            <legend className="eyebrow px-1 text-warn">{t("ownership")}</legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="ownership" value="keep" defaultChecked className="accent-primary" />
              {t("ownershipContactOnly")}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="ownership" value="relink" className="accent-primary" />
              {t("ownershipRelink", { name: contactLabel })}
            </label>
          </fieldset>
        )}
      </section>

      {/* 03 — details */}
      <section className="relative border bg-card p-4">
        <SectionHeader index="03" icon={Phone} label={t("detailsSection")} />
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="checkin-note">{t("noteLabel")}</Label>
            <Textarea id="checkin-note" name="note" rows={3} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="checkin-odometer">{t("odometerLabel")}</Label>
            <Input
              id="checkin-odometer"
              name="odometer"
              inputMode="numeric"
              className="num max-w-40"
            />
          </div>
        </div>
      </section>

      {/* 04 — photos */}
      <section className="relative border bg-card p-4">
        <SectionHeader index="04" icon={Camera} label={t("photosSection")} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void addFiles(e.target.files)}
        />
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {photos.map((photo, index) => (
            <div key={photo.id} className="group relative border bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img
                src={photo.url}
                alt={`${index + 1}`}
                className="aspect-square w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                aria-label={t("removePhoto")}
                className="absolute right-0.5 top-0.5 hidden border border-bad/60 bg-background/80 p-0.5 text-bad group-hover:block"
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={processing}
            className="flex aspect-square items-center justify-center border border-dashed text-faint transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <span className="flex flex-col items-center gap-1 text-[10px]">
              <Camera className="size-4" aria-hidden />
              {t("addPhotos")}
            </span>
          </button>
        </div>
      </section>

      {error && (
        <p role="alert" className="border border-bad/40 px-3 py-2 text-xs text-bad">
          {t(`errors.${error}`)}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending || processing || uploading != null}
        className="h-9 self-start px-4 font-semibold"
      >
        {uploading
          ? t("uploadingPhotos", uploading)
          : pending
            ? t("submitting")
            : t("submit")}
      </Button>
    </form>
  );
}
