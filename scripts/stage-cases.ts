import "./load-env";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { prismaUnscoped } from "../lib/db";
import { buildQuotationBody } from "../lib/line-draft";
import type {
  DamageType,
  FindingCondition,
  JobStatus,
  PartOrderStatus,
  PayerType,
  WaitingReason,
} from "../lib/generated/prisma/enums";
import { newPhotoKey, photoStore } from "../lib/storage";

/**
 * M7.5 staging (brief "Done when"), extended in M7.7: one Repair Case per
 * Stage, on the pilot shop, so the rebuilt page and board can be walked as
 * a stranger — fresh assessment, findings still being keyed in, an unpriced
 * line, a priced Offer not yet sent, a SENT Offer (Quotation + LINE Update
 * with the document link), a recorded Response (Work and Done phases),
 * waiting on parts, in progress (with a cancelled job), in QC, ready,
 * delivered-with-balance, delivered-settled. DEV ONLY — direct writes, not
 * the flows; performing the flows remains each milestone's gate.
 *
 * Idempotent via .data/staged-cases.json: a re-run deletes what the last
 * run created, then stages afresh. Usage: npx tsx scripts/stage-cases.ts
 */

const STATE_FILE = path.join(process.cwd(), ".data", "staged-cases.json");

/* ------------------------------------------------------------------ */
/* Tiny PNG writer — solid two-tone walkaround stand-ins for D-9.      */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

type Rgb = [number, number, number];

/** A car-ish placeholder: sky-to-body vertical gradient with a ground band. */
function carPng(body: Rgb, width = 480, height = 360): Buffer {
  const sky: Rgb = [24, 24, 27];
  const ground: Rgb = [16, 16, 18];
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: none
    const inGround = y > height * 0.78;
    const mix = Math.min(1, y / (height * 0.7));
    for (let x = 0; x < width; x++) {
      const base = inGround ? ground : sky;
      for (let i = 0; i < 3; i++) {
        raw[offset++] = inGround
          ? base[i]!
          : Math.round(sky[i]! + (body[i]! - sky[i]!) * mix);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Cast & fixtures.                                                    */
/* ------------------------------------------------------------------ */

const SHOP_NAME = "Somchai Garage";
/**
 * The LINE identities the sent-Offer cases are linked to — stand-in userIds
 * (M7.7), one per case because a Customer holds at most one contact.
 */
const STAGED_LINE_USER_PREFIX = "U00000000000000000000000000stage";
let stagedLineUsers = 0;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const daysAhead = (d: number) => new Date(Date.now() + d * 86_400_000);
const baht = (b: number) => b * 100;

type StagedVehicle = {
  plate: string;
  province: string;
  bodyType: "SEDAN" | "PICKUP";
  make: string;
  model: string;
  color: string;
  hue: Rgb;
};

const EXTRA_CUSTOMERS: { name: string; phone: string; vehicle: StagedVehicle }[] = [
  { name: "นภัสสร ชัยวัฒน์", phone: "0812223344", vehicle: { plate: "กท5566", province: "กรุงเทพมหานคร", bodyType: "SEDAN", make: "Toyota", model: "Vios", color: "ขาว", hue: [216, 217, 220] } },
  { name: "ธีรภัทร บุญมาก", phone: "0876665544", vehicle: { plate: "บล7788", province: "ปทุมธานี", bodyType: "PICKUP", make: "Ford", model: "Ranger", color: "ดำ", hue: [52, 54, 58] } },
  { name: "สายฝน อินทร์แก้ว", phone: "0898887766", vehicle: { plate: "ษม1122", province: "กรุงเทพมหานคร", bodyType: "SEDAN", make: "Honda", model: "City", color: "แดง", hue: [164, 46, 42] } },
  { name: "กิตติ พูลสวัสดิ์", phone: "0845553311", vehicle: { plate: "ฒบ4433", province: "นนทบุรี", bodyType: "PICKUP", make: "Mitsubishi", model: "Triton", color: "เทา", hue: [120, 124, 130] } },
  { name: "วราภรณ์ สุขสันต์", phone: "0823334455", vehicle: { plate: "จร9911", province: "กรุงเทพมหานคร", bodyType: "SEDAN", make: "Nissan", model: "Almera", color: "น้ำเงิน", hue: [44, 74, 132] } },
  { name: "อนันต์ เรืองศรี", phone: "0867778899", vehicle: { plate: "ภน6644", province: "สมุทรปราการ", bodyType: "SEDAN", make: "Toyota", model: "Camry", color: "ดำ", hue: [40, 42, 46] } },
];

/** Hues for the seed vehicles that get staged cases too. */
const SEED_HUES: Record<string, Rgb> = {
  "ขข1234": [222, 222, 224], // Civic ขาว
  "งจ7788": [150, 44, 40], // Mazda 2 แดง
  "ตค9012": [110, 114, 120], // D-Max เทา
  "ผก4455": [48, 50, 54], // Hilux ดำ
};

async function main() {
  const shop = await prismaUnscoped.shop.findFirst({ where: { name: SHOP_NAME } });
  if (!shop) throw new Error("Pilot shop missing — run `npm run db:seed` first");
  const shopId = shop.id;

  /* -------- tear down the previous staging run -------- */
  let previous: string[] = [];
  try {
    previous = JSON.parse(await readFile(STATE_FILE, "utf8")) as string[];
  } catch {
    // first run
  }
  if (previous.length > 0) {
    await prismaUnscoped.$transaction([
      prismaUnscoped.followUp.deleteMany({ where: { caseId: { in: previous } } }),
      prismaUnscoped.caseEvent.deleteMany({ where: { caseId: { in: previous } } }),
      prismaUnscoped.payment.deleteMany({ where: { caseId: { in: previous } } }),
      prismaUnscoped.lineUpdatePhoto.deleteMany({ where: { lineUpdate: { caseId: { in: previous } } } }),
      prismaUnscoped.lineUpdate.deleteMany({ where: { caseId: { in: previous } } }),
      prismaUnscoped.photo.deleteMany({ where: { caseId: { in: previous } } }),
      prismaUnscoped.partLine.deleteMany({ where: { job: { caseId: { in: previous } } } }),
      prismaUnscoped.jobAuthorization.deleteMany({ where: { job: { caseId: { in: previous } } } }),
      prismaUnscoped.quotationLine.deleteMany({ where: { quotation: { caseId: { in: previous } } } }),
      prismaUnscoped.quotation.deleteMany({ where: { caseId: { in: previous } } }),
      prismaUnscoped.finding.deleteMany({ where: { caseId: { in: previous } } }),
      prismaUnscoped.job.deleteMany({ where: { caseId: { in: previous } } }),
      prismaUnscoped.repairCase.deleteMany({ where: { id: { in: previous } } }),
      // The stand-in LINE identity the sent-Offer case links (M7.7).
      prismaUnscoped.lineContact.deleteMany({
        where: { shopId, lineUserId: { startsWith: STAGED_LINE_USER_PREFIX } },
      }),
    ]);
    console.log(`cleared previous staging run (${previous.length} cases)`);
  }

  /* -------- cast -------- */
  const staffByName = async (name: string) => {
    const staff = await prismaUnscoped.staff.findFirst({ where: { shopId, name } });
    if (!staff) throw new Error(`staff missing: ${name} — run db:seed`);
    return staff;
  };
  const advisor = await staffByName("คุณแอน");
  const manager = await staffByName("สมชาย ใจดี");
  const bodyTech = await staffByName("สมศักดิ์ ฝีมือดี");
  const painter = await staffByName("วินัย สีสวย");

  /* -------- extra customers & vehicles -------- */
  const vehicleHue = new Map<string, Rgb>(Object.entries(SEED_HUES));
  for (const spec of EXTRA_CUSTOMERS) {
    const customer = await prismaUnscoped.customer.upsert({
      where: { shopId_phone: { shopId, phone: spec.phone } },
      update: {},
      create: { shopId, name: spec.name, phone: spec.phone },
    });
    const { hue, ...vehicle } = spec.vehicle;
    await prismaUnscoped.vehicle.upsert({
      where: { shopId_plate: { shopId, plate: vehicle.plate } },
      update: {},
      create: { shopId, primaryCustomerId: customer.id, ...vehicle },
    });
    vehicleHue.set(vehicle.plate, hue);
  }

  const vehicleByPlate = async (plate: string) => {
    const vehicle = await prismaUnscoped.vehicle.findUnique({
      where: { shopId_plate: { shopId, plate } },
      include: { primaryCustomer: true },
    });
    if (!vehicle) throw new Error(`vehicle missing: ${plate}`);
    return vehicle;
  };

  /* -------- helpers -------- */
  const stagedIds: string[] = [];

  async function nextReference(): Promise<string> {
    const bumped = await prismaUnscoped.shop.update({
      where: { id: shopId },
      data: { caseSeq: { increment: 1 } },
      select: { caseSeq: true },
    });
    return `RC-${bumped.caseSeq}`;
  }

  type JobSpec = {
    title: string;
    status: JobStatus;
    waitingReason?: WaitingReason;
    payerType?: PayerType;
    insurerName?: string;
    priceBaht?: number;
    tech?: { id: string };
    authorized?: { channel: "PHONE" | "IN_PERSON" | "LINE"; note?: string; againstQuotation?: boolean };
    declined?: { channel: "PHONE" | "IN_PERSON" | "LINE"; note?: string; againstQuotation?: boolean };
    cancelledNote?: string;
    parts?: {
      name: string;
      qty?: number;
      costBaht?: number;
      supplier?: string;
      status: PartOrderStatus;
      etaDaysAhead?: number;
      note?: string;
    }[];
  };

  type FindingSpec = {
    zone?: string;
    checklistItem?: string;
    damageTypes?: DamageType[];
    condition?: FindingCondition;
    note?: string;
    /** Index into the jobs array once created; omitted = ungrouped. */
    jobIndex?: number;
    /** Still being keyed in (confirmedAt NULL). Grouped findings are always accepted. */
    draft?: boolean;
  };

  async function stageCase(spec: {
    plate: string;
    checkedInHoursAgo: number;
    note?: string;
    odometerKm?: number;
    photos?: number;
    status?: "CHECKED_IN" | "READY" | "DELIVERED";
    readyHoursAgo?: number;
    deliveredHoursAgo?: number;
    jobs?: JobSpec[];
    findings?: FindingSpec[];
    /**
     * M7.7: a Quotation covering the listed jobs (indexes) at their prices —
     * the version Send quotation would have stamped — and, when `sent`, the
     * document link plus the LINE Update that carried it.
     */
    quotation?: { jobIndexes: number[]; sent?: boolean; hoursAgo?: number };
    payments?: {
      payerType: PayerType;
      insurerName?: string;
      amountBaht: number;
      method?: "CASH" | "TRANSFER" | "CARD";
      note?: string;
      daysAgo?: number;
    }[];
  }) {
    const vehicle = await vehicleByPlate(spec.plate);
    const reference = await nextReference();
    const checkedInAt = hoursAgo(spec.checkedInHoursAgo);

    const repairCase = await prismaUnscoped.repairCase.create({
      data: {
        shopId,
        reference,
        status: spec.status ?? "CHECKED_IN",
        vehicleId: vehicle.id,
        contactCustomerId: vehicle.primaryCustomerId,
        note: spec.note ?? null,
        odometerKm: spec.odometerKm ?? null,
        checkedInAt,
        openedByStaffId: advisor.id,
        readyAt: spec.readyHoursAgo != null ? hoursAgo(spec.readyHoursAgo) : null,
        deliveredAt: spec.deliveredHoursAgo != null ? hoursAgo(spec.deliveredHoursAgo) : null,
        deliveredByStaffId: spec.deliveredHoursAgo != null ? manager.id : null,
      },
    });
    stagedIds.push(repairCase.id);

    // Walkaround photos (D-9): the first becomes the case's face.
    const hue = vehicleHue.get(spec.plate) ?? [90, 90, 96];
    for (let i = 0; i < (spec.photos ?? 0); i++) {
      const shade: Rgb = [
        Math.max(0, hue[0] - i * 14),
        Math.max(0, hue[1] - i * 14),
        Math.max(0, hue[2] - i * 14),
      ];
      const bytes = new Uint8Array(carPng(shade));
      const storageKey = newPhotoKey(shopId, repairCase.id, "image/png");
      await photoStore.put(storageKey, bytes, "image/png");
      await prismaUnscoped.photo.create({
        data: {
          shopId,
          caseId: repairCase.id,
          storageKey,
          contentType: "image/png",
          sizeBytes: bytes.byteLength,
          capturedAt: new Date(checkedInAt.getTime() + i * 60_000),
          uploadedByStaffId: advisor.id,
        },
      });
    }

    const jobRows: Awaited<ReturnType<typeof prismaUnscoped.job.create>>[] = [];
    const pendingAuth: { row: { id: string; title: string }; job: JobSpec }[] = [];
    for (const job of spec.jobs ?? []) {
      const row = await prismaUnscoped.job.create({
        data: {
          shopId,
          caseId: repairCase.id,
          title: job.title,
          status: job.status,
          waitingReason: job.waitingReason ?? null,
          payerType: job.payerType ?? "CUSTOMER",
          insurerName: job.insurerName ?? null,
          priceSatang: job.priceBaht != null ? baht(job.priceBaht) : null,
          assignedStaffId: job.tech?.id ?? null,
          createdByStaffId: advisor.id,
          createdAt: new Date(checkedInAt.getTime() + 30 * 60_000),
        },
      });
      jobRows.push(row);
      // Authorizations are recorded after the quotation exists (below) so a
      // Response can name the version it answered.
      pendingAuth.push({ row, job });
      if (job.cancelledNote) {
        await prismaUnscoped.caseEvent.create({
          data: {
            shopId,
            caseId: repairCase.id,
            type: "JOB_CANCELLED",
            jobId: row.id,
            jobTitle: row.title,
            fromStatus: "IN_PROGRESS",
            toStatus: "CANCELLED",
            note: job.cancelledNote,
            actorStaffId: manager.id,
            at: new Date(checkedInAt.getTime() + 5 * 3_600_000),
          },
        });
      }
      for (const part of job.parts ?? []) {
        await prismaUnscoped.partLine.create({
          data: {
            shopId,
            jobId: row.id,
            name: part.name,
            quantity: part.qty ?? 1,
            unitCostSatang: part.costBaht != null ? baht(part.costBaht) : null,
            supplier: part.supplier ?? null,
            orderStatus: part.status,
            etaDate: part.etaDaysAhead != null ? daysAhead(part.etaDaysAhead) : null,
            note: part.note ?? null,
          },
        });
      }
    }

    // The Quotation (M7.7): stamped by sending, immutable — lines snapshot
    // the jobs' current titles and prices. A sent one carries the document
    // token and the LINE Update the customer received.
    let quotationId: string | null = null;
    if (spec.quotation) {
      const covered = spec.quotation.jobIndexes.map((index) => jobRows[index]!);
      const issuedAt = hoursAgo(spec.quotation.hoursAgo ?? spec.checkedInHoursAgo - 2);
      const quotation = await prismaUnscoped.quotation.create({
        data: {
          shopId,
          caseId: repairCase.id,
          number: `Q-${reference.replace(/^RC-?/, "")}`,
          version: 1,
          totalSatang: covered.reduce((sum, job) => sum + (job.priceSatang ?? 0), 0),
          issuedByStaffId: advisor.id,
          issuedAt,
          publicToken: spec.quotation.sent ? randomBytes(16).toString("hex") : null,
          lines: {
            create: covered.map((job, index) => ({
              jobId: job.id,
              title: job.title,
              priceSatang: job.priceSatang ?? 0,
              payerType: job.payerType,
              insurerName: job.insurerName,
              sortOrder: index,
            })),
          },
        },
      });
      quotationId = quotation.id;
      await prismaUnscoped.caseEvent.create({
        data: {
          shopId,
          caseId: repairCase.id,
          type: "QUOTATION_ISSUED",
          quotationId: quotation.id,
          actorStaffId: advisor.id,
          at: issuedAt,
        },
      });
      if (spec.quotation.sent) {
        // A linked LINE identity for the contact, so the send gate is open too.
        stagedLineUsers += 1;
        const lineUserId = `${STAGED_LINE_USER_PREFIX}${stagedLineUsers}`;
        await prismaUnscoped.lineContact.deleteMany({
          where: { shopId, customerId: vehicle.primaryCustomerId },
        });
        await prismaUnscoped.lineContact.create({
          data: {
            shopId,
            lineUserId,
            displayName: "LINE user (staged)",
            customerId: vehicle.primaryCustomerId,
            linkedByStaffId: advisor.id,
            linkedAt: issuedAt,
          },
        });
        const update = await prismaUnscoped.lineUpdate.create({
          data: {
            shopId,
            caseId: repairCase.id,
            customerId: vehicle.primaryCustomerId,
            lineUserId,
            recipientName: vehicle.primaryCustomer.name,
            bodyText: buildQuotationBody({
              shopName: SHOP_NAME,
              customerName: vehicle.primaryCustomer.name,
              plate: vehicle.plate,
              reference,
              label: `Q-${reference.replace(/^RC-?/, "")}`,
              lines: covered.map((job) => ({ title: job.title, priceSatang: job.priceSatang ?? 0 })),
              totalSatang: covered.reduce((sum, job) => sum + (job.priceSatang ?? 0), 0),
              documentUrl: `http://localhost:3000/q/${quotation.publicToken}`,
            }),
            deliveryStatus: "SENT",
            lineRequestId: "staged",
            quotationId: quotation.id,
            sentByStaffId: advisor.id,
            sentAt: issuedAt,
          },
        });
        await prismaUnscoped.caseEvent.create({
          data: {
            shopId,
            caseId: repairCase.id,
            type: "LINE_UPDATE_SENT",
            lineUpdateId: update.id,
            subjectName: vehicle.primaryCustomer.name,
            actorStaffId: advisor.id,
            at: issuedAt,
          },
        });
      }
    }

    for (const { row, job } of pendingAuth) {
      const decision = job.authorized ? "AUTHORIZED" : job.declined ? "DECLINED" : null;
      const answer = job.authorized ?? job.declined;
      if (!decision || !answer) continue;
      const recordedAt = new Date(checkedInAt.getTime() + 90 * 60_000);
      await prismaUnscoped.jobAuthorization.create({
        data: {
          shopId,
          jobId: row.id,
          decision,
          channel: answer.channel,
          note: answer.note ?? null,
          quotationId: answer.againstQuotation ? quotationId : null,
          recordedByStaffId: advisor.id,
          recordedAt,
        },
      });
      await prismaUnscoped.caseEvent.create({
        data: {
          shopId,
          caseId: repairCase.id,
          type: "JOB_AUTHORIZATION_RECORDED",
          jobId: row.id,
          jobTitle: row.title,
          fromStatus: "PROPOSED",
          toStatus: decision,
          note: answer.note ?? null,
          actorStaffId: advisor.id,
          at: recordedAt,
        },
      });
    }

    for (const finding of spec.findings ?? []) {
      const recordedAt = new Date(checkedInAt.getTime() + 15 * 60_000);
      await prismaUnscoped.finding.create({
        data: {
          shopId,
          caseId: repairCase.id,
          source: finding.zone ? "DAMAGE_MAP" : "CHECKLIST",
          zone: finding.zone ?? null,
          checklistItem: finding.checklistItem ?? null,
          damageTypes: finding.damageTypes ?? [],
          condition: finding.condition ?? null,
          note: finding.note ?? null,
          jobId: finding.jobIndex != null ? jobRows[finding.jobIndex]!.id : null,
          recordedByStaffId: advisor.id,
          recordedAt,
          // Accepted unless still being keyed in; a grouped Finding is always
          // accepted (D-24: accept is what made its line).
          confirmedAt: finding.draft ? null : new Date(recordedAt.getTime() + 60_000),
        },
      });
    }

    for (const payment of spec.payments ?? []) {
      await prismaUnscoped.payment.create({
        data: {
          shopId,
          caseId: repairCase.id,
          payerType: payment.payerType,
          insurerName: payment.insurerName ?? null,
          amountSatang: baht(payment.amountBaht),
          method: payment.method ?? "CASH",
          receivedAt: hoursAgo((payment.daysAgo ?? 0) * 24),
          note: payment.note ?? null,
          recordedByStaffId: advisor.id,
        },
      });
    }

    if (spec.status === "READY" && spec.readyHoursAgo != null) {
      await prismaUnscoped.caseEvent.create({
        data: {
          shopId,
          caseId: repairCase.id,
          type: "CASE_READY",
          actorStaffId: advisor.id,
          at: hoursAgo(spec.readyHoursAgo),
        },
      });
    }
    if (spec.status === "DELIVERED" && spec.deliveredHoursAgo != null) {
      await prismaUnscoped.caseEvent.create({
        data: {
          shopId,
          caseId: repairCase.id,
          type: "CASE_DELIVERED",
          actorStaffId: manager.id,
          at: hoursAgo(spec.deliveredHoursAgo),
        },
      });
    }

    console.log(`staged ${reference} — ${spec.plate}`);
    return repairCase;
  }

  /* -------- one case per Stage -------- */

  // 1 · In assessment, fresh check-in → "Open inspection"
  await stageCase({
    plate: "ขข1234",
    checkedInHoursAgo: 1,
    note: "เสียงดังจากล้อหน้าเวลาเบรก ขอตรวจช่วงล่างด้วย",
    odometerKm: 45_120,
    photos: 3,
  });

  // 2 · In assessment, findings still being keyed in (unaccepted) → "Open inspection".
  //     Accepting any of them puts its line in the Offer (D-24).
  await stageCase({
    plate: "กท5566",
    checkedInHoursAgo: 3,
    note: "เฉี่ยวเสากันสาดหน้าบ้าน",
    odometerKm: 61_480,
    photos: 2,
    findings: [
      { zone: "front-bumper", damageTypes: ["DENT", "SCRATCH"], draft: true },
      { zone: "door-fl", damageTypes: ["SCRATCH"], draft: true },
      { checklistItem: "brakes", condition: "NEEDS_WORK", note: "ผ้าเบรกหน้าเหลือ ~20%", draft: true },
    ],
  });

  // 3 · Awaiting authorization with an unpriced line → "Set prices"
  await stageCase({
    plate: "บล7788",
    checkedInHoursAgo: 5,
    odometerKm: 98_302,
    photos: 1,
    jobs: [{ title: "กันชนหลัง — เปลี่ยน", status: "PROPOSED" }],
    findings: [{ zone: "rear-bumper", damageTypes: ["BROKEN"], jobIndex: 0 }],
  });

  // 4 · Awaiting authorization, priced, not sent yet (mixed payers) →
  //     "Send quotation" + "Record response"
  await stageCase({
    plate: "ผก4455",
    checkedInHoursAgo: 26,
    note: "รถบริษัท — เคลมประกันฝั่งซ้าย",
    odometerKm: 152_770,
    photos: 2,
    jobs: [
      { title: "ทำสีประตูซ้ายหน้า", status: "PROPOSED", priceBaht: 8_500 },
      {
        title: "เปลี่ยนไฟท้ายขวา",
        status: "PROPOSED",
        priceBaht: 4_500,
        payerType: "INSURER",
        insurerName: "วิริยะประกันภัย",
      },
    ],
    findings: [
      { zone: "door-fl", damageTypes: ["SCRATCH", "DENT"], jobIndex: 0 },
      { zone: "taillight-r", damageTypes: ["BROKEN"], jobIndex: 1 },
    ],
  });

  // 4b · Offer SENT (M7.7): Q-10xx stamped and pushed over LINE with the
  //      document link → "Record response" leads; the foot reads "sent … via LINE"
  await stageCase({
    plate: "กท5566",
    checkedInHoursAgo: 20,
    note: "เฉี่ยวรถข้างบ้าน ฝั่งซ้าย",
    odometerKm: 61_530,
    photos: 2,
    jobs: [
      { title: "ทำสีด้านซ้ายทั้งแถบ", status: "PROPOSED", priceBaht: 12_000 },
      { title: "เปลี่ยนผ้าเบรกหน้า", status: "PROPOSED", priceBaht: 2_800 },
      { title: "เปลี่ยนกระจกบังลมหลัง", status: "PROPOSED", priceBaht: 6_800 },
    ],
    findings: [
      { zone: "door-fl", damageTypes: ["DENT"], note: "รอยบุบกลางบาน", jobIndex: 0 },
      { zone: "door-rl", damageTypes: ["SCRATCH"], note: "รอยขีดยาว", jobIndex: 0 },
      { checklistItem: "brakes", condition: "NEEDS_WORK", jobIndex: 1 },
      { zone: "rear-glass", damageTypes: ["CRACK"], jobIndex: 2 },
    ],
    quotation: { jobIndexes: [0, 1, 2], sent: true, hoursAgo: 18 },
  });

  // 4c · Response RECORDED (M7.7): two yes, one no against the sent version →
  //      Work holds two Authorized cards leading with Start work, Done the declined line
  await stageCase({
    plate: "บล7788",
    checkedInHoursAgo: 28,
    odometerKm: 98_410,
    photos: 1,
    jobs: [
      {
        title: "ทำสีฝากระโปรงหน้า",
        status: "AUTHORIZED",
        priceBaht: 6_500,
        authorized: { channel: "LINE", againstQuotation: true },
      },
      {
        title: "เปลี่ยนแบตเตอรี่",
        status: "AUTHORIZED",
        priceBaht: 3_200,
        authorized: { channel: "LINE", againstQuotation: true },
      },
      {
        title: "เปลี่ยนกระจกบังลมหน้า",
        status: "DECLINED",
        priceBaht: 18_000,
        declined: { channel: "LINE", note: "ราคากระจกสูงไป — ไว้คราวหน้า", againstQuotation: true },
      },
    ],
    findings: [
      { zone: "hood", damageTypes: ["DENT"], jobIndex: 0 },
      { checklistItem: "battery", condition: "NEEDS_WORK", jobIndex: 1 },
      { zone: "windshield", damageTypes: ["CRACK"], jobIndex: 2 },
    ],
    quotation: { jobIndexes: [0, 1, 2], sent: true, hoursAgo: 24 },
  });

  // 5 · Waiting — parts (blocker in the header: 2 parts due)
  await stageCase({
    plate: "ฒบ4433",
    checkedInHoursAgo: 50,
    odometerKm: 187_940,
    photos: 2,
    jobs: [
      {
        title: "เปลี่ยนชุดคลัตช์",
        status: "WAITING",
        waitingReason: "PARTS",
        priceBaht: 12_000,
        tech: bodyTech,
        authorized: { channel: "PHONE" },
        parts: [
          { name: "จานคลัตช์", costBaht: 3_200, supplier: "ศรีสยามอะไหล่", status: "ARRIVED" },
          { name: "ชุดลูกปืนคลัตช์", costBaht: 1_450, supplier: "ศรีสยามอะไหล่", status: "ORDERED", etaDaysAhead: 3 },
          { name: "สายคลัตช์", costBaht: 380, status: "NOT_ORDERED", etaDaysAhead: 6 },
        ],
      },
      {
        title: "เปลี่ยนถ่ายน้ำมันเครื่อง + ไส้กรอง",
        status: "COMPLETED",
        priceBaht: 1_500,
        tech: painter,
        authorized: { channel: "IN_PERSON" },
      },
    ],
    payments: [{ payerType: "CUSTOMER", amountBaht: 5_000, note: "มัดจำ", daysAgo: 2 }],
  });

  // 6 · In progress — plus a cancelled job's one quiet line
  await stageCase({
    plate: "งจ7788",
    checkedInHoursAgo: 30,
    odometerKm: 74_211,
    photos: 2,
    jobs: [
      {
        title: "ทำสีฝากระโปรงหน้า",
        status: "IN_PROGRESS",
        priceBaht: 6_500,
        tech: painter,
        authorized: { channel: "LINE" },
      },
      {
        title: "เปลี่ยนผ้าเบรกหน้า",
        status: "COMPLETED",
        priceBaht: 2_800,
        tech: bodyTech,
        authorized: { channel: "IN_PERSON" },
      },
      {
        title: "เปลี่ยนกระจกมองข้างซ้าย",
        status: "CANCELLED",
        priceBaht: 2_200,
        authorized: { channel: "PHONE" },
        cancelledNote: "ลูกค้าขอหยุดงานนี้ — รอเคลมประกันรอบหน้า",
      },
    ],
    findings: [
      { zone: "hood", damageTypes: ["SCRATCH", "DENT"], jobIndex: 0 },
      { checklistItem: "brakes", condition: "NEEDS_WORK", jobIndex: 1 },
      { zone: "mirror-l", damageTypes: ["BROKEN"], jobIndex: 2 },
    ],
  });

  // 7 · In QC → "Record QC result"
  await stageCase({
    plate: "ษม1122",
    checkedInHoursAgo: 76,
    odometerKm: 33_602,
    photos: 2,
    jobs: [
      {
        title: "ทำสีกันชนหน้า + พ่นเคลียร์",
        status: "QC",
        priceBaht: 7_200,
        tech: painter,
        authorized: { channel: "PHONE" },
      },
    ],
    findings: [{ zone: "front-bumper", damageTypes: ["SCRATCH"], jobIndex: 0 }],
  });

  // 8 · Ready — leads with the amount to collect
  await stageCase({
    plate: "จร9911",
    checkedInHoursAgo: 100,
    status: "READY",
    readyHoursAgo: 2,
    odometerKm: 58_006,
    photos: 2,
    jobs: [
      {
        title: "เคาะโป๊วประตูหลังซ้าย + ทำสี",
        status: "COMPLETED",
        priceBaht: 9_500,
        tech: bodyTech,
        authorized: { channel: "PHONE" },
      },
      {
        title: "เปลี่ยนแบตเตอรี่",
        status: "COMPLETED",
        priceBaht: 3_200,
        tech: painter,
        authorized: { channel: "IN_PERSON" },
      },
    ],
    findings: [{ zone: "door-rl", damageTypes: ["DENT"], jobIndex: 0 }],
    payments: [{ payerType: "CUSTOMER", amountBaht: 4_000, note: "มัดจำ", daysAgo: 3 }],
  });

  // 9 · Delivered — balance due (insurer pays weeks late)
  await stageCase({
    plate: "ตค9012",
    checkedInHoursAgo: 9 * 24,
    status: "DELIVERED",
    readyHoursAgo: 2 * 24,
    deliveredHoursAgo: 26,
    odometerKm: 201_113,
    photos: 2,
    note: "เคลมประกัน — ชนท้าย",
    jobs: [
      {
        title: "ซ่อมแชสซีท้าย + ทำสี",
        status: "COMPLETED",
        priceBaht: 25_000,
        payerType: "INSURER",
        insurerName: "ทิพยประกันภัย",
        tech: bodyTech,
        authorized: { channel: "PHONE", note: "เคลม TIP-88012" },
      },
      {
        title: "เปลี่ยนยางปัดน้ำฝน",
        status: "COMPLETED",
        priceBaht: 350,
        tech: painter,
        authorized: { channel: "IN_PERSON" },
      },
    ],
    payments: [{ payerType: "CUSTOMER", amountBaht: 350, method: "TRANSFER", daysAgo: 1 }],
  });

  // 10 · Delivered — settled: the closed record (with a declined follow-up seed)
  await stageCase({
    plate: "ภน6644",
    checkedInHoursAgo: 6 * 24,
    status: "DELIVERED",
    readyHoursAgo: 5 * 24 + 3,
    deliveredHoursAgo: 5 * 24,
    odometerKm: 121_889,
    photos: 1,
    jobs: [
      {
        title: "ตรวจเช็กระยะ",
        status: "COMPLETED",
        priceBaht: 1_200,
        tech: painter,
        authorized: { channel: "IN_PERSON" },
      },
      {
        title: "เปลี่ยนกระจกบังลมหน้า",
        status: "DECLINED",
        priceBaht: 18_000,
        declined: { channel: "PHONE", note: "ขอคิดดูก่อน แพงไปหน่อย" },
      },
    ],
    findings: [{ zone: "windshield", damageTypes: ["CRACK"], jobIndex: 1 }],
    payments: [{ payerType: "CUSTOMER", amountBaht: 1_200, method: "TRANSFER", daysAgo: 5 }],
  });

  await writeFile(STATE_FILE, JSON.stringify(stagedIds, null, 2));
  console.log(`\nstaged ${stagedIds.length} cases — state in ${STATE_FILE}`);
}

main()
  .then(() => prismaUnscoped.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prismaUnscoped.$disconnect();
    process.exit(1);
  });
