import type { BodyType } from "@/lib/generated/prisma/enums";
import type { ZoneId } from "@/lib/inspection";

/**
 * Damage Map geometry — the founder-approved five-view unfolded sheet
 * (DESIGN.md D-5): programmatic, typed, in-repo. The M0 mockup is the layout
 * reference; the artwork here is redrawn with real automotive proportions
 * (≈137 px/m: 2.9 m wheelbase, correct overhangs), beziered silhouettes, and
 * zone boundaries that follow actual panel cut lines.
 *
 * Sheet layout (viewBox 0 0 1000 740), insurance-sheet style:
 *   LEFT profile across the top · TOP view centered · FRONT and REAR faces
 *   flanking it · RIGHT profile across the bottom (the left profile mirrored,
 *   so both noses point outward like an unfolded sheet).
 *
 * Everything is stroke-based line art; colors come from CSS variables at
 * render time (see damage-map.tsx). Zones are transparent hit/fill shapes
 * stacked ABOVE the decor strokes; wheels sit above fenders so arches stay
 * tappable as wheels.
 */

export const SHEET = { width: 1000, height: 740 } as const;

export type ViewId = "left" | "right" | "top" | "front" | "rear";

export type ZoneShape = {
  zone: ZoneId;
  /** SVG path data in the view's authored coordinates. */
  d: string;
  /** Badge anchor (authored coords) — mapped through the view transform. */
  anchor: readonly [number, number];
};

export type ViewGeometry = {
  id: ViewId;
  /** SVG transform applied to the whole view group ("" = none). */
  transform: string;
  /** Maps an authored point into final sheet coordinates. */
  mapPoint: (p: readonly [number, number]) => readonly [number, number];
  /** Final sheet-coordinate bounds — used for single-view rendering. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Caption position in final sheet coordinates. */
  caption: readonly [number, number];
  decor: string[];
  /** Softer, dashed detail strokes (panel hints, glass separations). */
  decorSoft: string[];
  zones: ZoneShape[];
};

/* ---------- path helpers ---------- */

const px = (n: number) => +n.toFixed(1);

function poly(zone: ZoneId, pts: ReadonlyArray<readonly [number, number]>): ZoneShape {
  const d = `M ${pts.map(([x, y]) => `${px(x)},${px(y)}`).join(" L ")} Z`;
  const maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1]));
  return { zone, d, anchor: [maxX, minY] };
}

function path(zone: ZoneId, d: string, anchor: readonly [number, number]): ZoneShape {
  return { zone, d, anchor };
}

function circle(zone: ZoneId, cx: number, cy: number, r: number): ZoneShape {
  const d = `M ${cx - r},${cy} a ${r},${r} 0 1 0 ${2 * r},0 a ${r},${r} 0 1 0 ${-2 * r},0 Z`;
  return { zone, d, anchor: [cx + r * 0.72, cy - r * 0.72] };
}

function rect(
  zone: ZoneId,
  x: number,
  y: number,
  w: number,
  h: number,
  rx = 0,
): ZoneShape {
  const d = rx
    ? `M ${x + rx},${y} h ${w - 2 * rx} a ${rx},${rx} 0 0 1 ${rx},${rx} v ${h - 2 * rx} a ${rx},${rx} 0 0 1 ${-rx},${rx} h ${-(w - 2 * rx)} a ${rx},${rx} 0 0 1 ${-rx},${-rx} v ${-(h - 2 * rx)} a ${rx},${rx} 0 0 1 ${rx},${-rx} Z`
    : `M ${x},${y} h ${w} v ${h} h ${-w} Z`;
  return { zone, d, anchor: [x + w, y] };
}

/** Wheel detail decor: tire, rim, hub, five spokes. */
function wheelDecor(cx: number, cy: number, tire: number, rim: number): string[] {
  const spokes: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    spokes.push(
      `M ${px(cx + 5 * Math.cos(a))},${px(cy + 5 * Math.sin(a))} L ${px(cx + (rim - 4) * Math.cos(a))},${px(cy + (rim - 4) * Math.sin(a))}`,
    );
  }
  const ring = (r: number) =>
    `M ${cx - r},${cy} a ${r},${r} 0 1 0 ${2 * r},0 a ${r},${r} 0 1 0 ${-2 * r},0`;
  return [ring(tire), ring(rim), ...spokes];
}

/* =====================================================================
 * PROFILE (authored as the LEFT side, nose pointing left)
 *
 * Ground plan: nose x=162 · front axle x=290 · rear axle x=685 · tail x≈838
 * (2.9 m wheelbase, 0.93 m front / 1.1 m rear overhang at 137 px/m).
 * Vertical: roof y=45 · belt y≈95 · sill 170–177 · wheel centers y=161
 * (tire r=39, arch r=47) · underbody y=176.
 * =================================================================== */

const W = { fcx: 290, rcx: 685, cy: 161, tire: 39, rim: 23, arch: 47 };
const archHalf = Math.sqrt(W.arch ** 2 - (176 - W.cy) ** 2); // chord at y=176

function profileSilhouette(sedan: boolean): string {
  const fa = [W.fcx - archHalf, W.fcx + archHalf]; // front arch chord x
  const ra = [W.rcx - archHalf, W.rcx + archHalf]; // rear arch chord x
  if (sedan) {
    return [
      // raked nose + bumper face
      `M 172,170 L 165,152 Q 162,134 172,125 Q 180,117 198,112`,
      // hood to cowl, windshield, roof, C-pillar, trunk deck, tail
      `C 252,103 312,96 362,90 L 428,52 Q 438,45 452,45 L 558,45`,
      `Q 576,45 590,54 L 644,80 Q 662,84 706,86 Q 728,88 732,96 L 735,110 L 735,132`,
      `Q 735,144 728,148 L 723,170`,
      // underbody with the two wheel arches
      `L ${px(ra[1])},176 A ${W.arch},${W.arch} 0 1 0 ${px(ra[0])},176`,
      `L ${px(fa[1])},176 A ${W.arch},${W.arch} 0 1 0 ${px(fa[0])},176`,
      `L 176,176 Z`,
    ].join(" ");
  }
  // Pickup: raked nose, crew cab, flat bed rail, vertical tailgate.
  return [
    `M 172,170 L 165,150 Q 162,132 172,123 Q 180,115 198,110`,
    `C 248,102 306,95 352,89 L 404,52 Q 412,46 424,46 L 558,46`,
    `Q 570,46 574,54 L 584,86 L 826,86 Q 833,86 834,94 L 834,146 Q 834,152 828,154`,
    `L 824,170`,
    `L ${px(W.rcx + archHalf)},176 A ${W.arch},${W.arch} 0 1 0 ${px(W.rcx - archHalf)},176`,
    `L ${px(W.fcx + archHalf)},176 A ${W.arch},${W.arch} 0 1 0 ${px(W.fcx - archHalf)},176`,
    `L 176,176 Z`,
  ].join(" ");
}

function profileDecor(sedan: boolean): { decor: string[]; soft: string[] } {
  const decor: string[] = [profileSilhouette(sedan)];
  const soft: string[] = [];

  if (sedan) {
    // side glass (front + rear with C-pillar rake)
    decor.push(`M 372,90 L 431,56 L 466,56 L 466,90 Z`);
    decor.push(`M 474,56 L 548,56 Q 566,57 578,66 L 602,86 L 474,90 Z`);
    // headlight + taillight wedges
    decor.push(`M 197,112 L 242,106 L 246,117 L 202,122 Z`);
    decor.push(`M 712,89 L 731,97 L 734,110 L 714,103 Z`);
    // trunk shut line
    soft.push(`M 646,82 L 649,92`);
  } else {
    // pickup: door glass ×2, cab rear window, bed front wall, bed rail lip
    decor.push(`M 370,88 L 407,57 L 454,57 L 454,88 Z`);
    decor.push(`M 462,57 L 542,57 Q 554,58 558,64 L 564,84 L 462,86 Z`);
    decor.push(`M 566,56 L 576,56 L 584,84 L 572,84 Z`); // cab back window
    decor.push(`M 592,86 L 592,170`); // bed front wall
    soft.push(`M 592,92 L 826,92`); // inner bed rail
    decor.push(`M 197,110 L 240,104 L 244,115 L 202,120 Z`);
    decor.push(`M 826,92 L 833,94 L 834,112 L 827,110 Z`); // tail lamp hint
  }

  // door shut lines (B-pillar and door trailing edges)
  if (sedan) {
    soft.push(`M 366,93 L 366,170`, `M 470,56 L 470,170`, `M 580,68 L 580,170`);
    // handles
    decor.push(`M 428,102 h 17`, `M 522,102 h 17`);
    // character line
    soft.push(`M 214,126 L 700,117`);
    // fuel filler
    decor.push(`M 660,101 h 10 v 10 h -10 Z`);
  } else {
    soft.push(`M 364,92 L 364,170`, `M 458,57 L 458,170`, `M 574,66 L 574,170`);
    decor.push(`M 420,100 h 16`, `M 500,100 h 16`);
    soft.push(`M 214,124 L 580,115`);
    decor.push(`M 806,100 h 10 v 10 h -10 Z`);
  }

  // rocker line under the doors
  soft.push(sedan ? `M 340,170 L 640,170` : `M 340,170 L 636,170`);

  // wheels
  decor.push(...wheelDecor(W.fcx, W.cy, W.tire, W.rim));
  decor.push(...wheelDecor(W.rcx, W.cy, W.tire, W.rim));

  return { decor, soft };
}

/**
 * Profile zones, authored for the LEFT side. `side` swaps the l/r ids so the
 * mirrored group reports the right-hand panels.
 */
function profileZones(sedan: boolean, side: "l" | "r"): ZoneShape[] {
  const s = side;
  const fl = (base: string) => `${base}-f${s}` as ZoneId; // fender/door/wheel front
  const rl = (base: string) => `${base}-r${s}` as ZoneId; // door/wheel rear
  const one = (base: string) => `${base}-${s}` as ZoneId; // sill/mirror/quarter/bedside

  const zones: ZoneShape[] = [];

  // Front bumper: nose cap through the bumper cut line.
  zones.push(
    path(
      "front-bumper",
      sedan
        ? `M 172,170 L 165,152 Q 162,134 172,125 Q 180,117 198,112 L 208,120 L 208,170 Z`
        : `M 172,170 L 165,150 Q 162,132 172,123 Q 180,115 198,110 L 208,118 L 208,170 Z`,
      [206, 112],
    ),
  );

  // Front fender: bumper cut → door leading edge, hood underside → sill.
  zones.push(
    path(
      fl("fender"),
      sedan
        ? `M 208,120 C 258,110 314,99 362,92 L 366,93 L 366,170 L 208,170 Z`
        : `M 208,118 C 256,109 310,98 358,91 L 364,92 L 364,170 L 208,170 Z`,
      [358, 88],
    ),
  );

  // Hood: the sloping top band nose → cowl.
  zones.push(
    path(
      "hood",
      sedan
        ? `M 196,112 C 252,103 312,96 362,90 L 366,96 C 318,101 258,109 202,119 Z`
        : `M 196,110 C 248,102 306,95 352,89 L 356,95 C 310,100 254,108 202,117 Z`,
      [360, 86],
    ),
  );

  // Windshield: the raked A-pillar band.
  zones.push(
    path(
      "windshield",
      sedan
        ? `M 364,89 L 428,52 Q 438,45 452,45 L 456,51 Q 444,52 436,57 L 372,93 Z`
        : `M 354,88 L 404,52 Q 412,46 424,46 L 428,52 Q 418,53 411,58 L 362,92 Z`,
      [450, 42],
    ),
  );

  // Roof strip.
  zones.push(
    sedan
      ? path("roof", `M 456,45 L 558,45 Q 574,45 586,52 L 582,58 L 456,52 Z`, [578, 42])
      : path("roof", `M 428,46 L 558,46 Q 568,46 572,52 L 568,57 L 428,53 Z`, [562, 42]),
  );

  // Rear glass: sedan C-pillar rake · pickup cab back window.
  zones.push(
    sedan
      ? path("rear-glass", `M 590,54 L 646,79 L 640,86 L 582,59 Z`, [644, 74])
      : path("rear-glass", `M 572,53 L 582,84 L 574,86 L 564,56 Z`, [585, 52]),
  );

  if (sedan) {
    // Trunk: deck + upper tail.
    zones.push(
      path("trunk", `M 648,80 L 706,85 Q 728,88 732,96 L 733,106 L 722,101 L 645,89 Z`, [
        730, 82,
      ]),
    );
    // Doors include their glass (taxonomy: door glass counts as the door).
    zones.push(poly(fl("door"), [
      [368, 93],
      [430, 57],
      [466, 57],
      [466, 170],
      [368, 170],
    ]));
    zones.push(
      path(
        rl("door"),
        `M 474,57 L 548,57 Q 560,58 570,64 L 578,71 L 578,170 L 474,170 Z`,
        [572, 54],
      ),
    );
    // Quarter panel: C-pillar base to the tail, above the sill, minus bumper cap.
    zones.push(
      path(
        one("quarter"),
        `M 584,68 L 640,88 L 720,101 L 733,108 L 735,132 Q 735,144 728,148 L 704,148 L 704,170 L 584,170 Z`,
        [730, 100],
      ),
    );
    // Rear bumper cap.
    zones.push(poly("rear-bumper", [
      [704, 148],
      [728, 148],
      [723, 170],
      [704, 170],
    ]));
    zones.push(rect(one("sill"), 340, 170, 300, 7));
  } else {
    // Pickup: crew-cab doors, bedside with arch, tailgate band, stepped rear.
    zones.push(poly(fl("door"), [
      [366, 92],
      [406, 58],
      [456, 58],
      [456, 170],
      [366, 170],
    ]));
    zones.push(
      path(
        rl("door"),
        `M 462,58 L 544,58 Q 556,59 561,65 L 568,86 L 568,170 L 462,170 Z`,
        [560, 55],
      ),
    );
    zones.push(
      path(
        one("bedside"),
        `M 594,88 L 822,88 L 822,146 L 818,170 L 594,170 Z`,
        [818, 84],
      ),
    );
    zones.push(
      path(
        "tailgate",
        `M 826,88 Q 833,88 834,96 L 834,146 Q 834,152 828,154 L 822,152 L 822,88 Z`,
        [838, 86],
      ),
    );
    zones.push(poly("rear-bumper", [
      [806, 154],
      [830, 154],
      [824, 170],
      [806, 170],
    ]));
    zones.push(rect(one("sill"), 340, 170, 292, 7));
  }

  // Mirror at the A-pillar base.
  zones.push(
    sedan
      ? rect(one("mirror"), 420, 58, 19, 13, 2)
      : rect(one("mirror"), 398, 58, 19, 13, 2),
  );

  // Wheels last — they sit above the fender/quarter fills.
  zones.push(circle(fl("wheel"), W.fcx, W.cy, W.tire));
  zones.push(circle(rl("wheel"), W.rcx, W.cy, W.tire));

  return zones;
}

/* =====================================================================
 * TOP view (nose left, centered) — car x 268..732, y 262..466.
 * The upper side band is the LEFT side (it unfolds toward the left
 * profile above); the lower band is the RIGHT side.
 * Profile x maps to plan x with scale 0.686 (464/676).
 * =================================================================== */

const T = { noseX: 268, tailX: 732, topY: 264, botY: 464, bandH: 26 };
const planX = (profX: number) => px(T.noseX + (profX - 162) * 0.686);

function topOutline(): string {
  // Plan-form: widest near the B-pillar, tapering toward both bumpers.
  return [
    `M ${T.noseX},308 Q ${T.noseX},272 302,266 Q 470,260 698,266`,
    `Q ${T.tailX},271 ${T.tailX},304 L ${T.tailX},424`,
    `Q ${T.tailX},457 698,462 Q 470,468 302,462 Q ${T.noseX},456 ${T.noseX},420 Z`,
  ].join(" ");
}

function topDecor(sedan: boolean): { decor: string[]; soft: string[] } {
  const decor: string[] = [topOutline()];
  const soft: string[] = [];
  // A-pillars from windshield base corners to the roof corners
  const cowl = planX(sedan ? 362 : 352);
  const aTop = planX(sedan ? 452 : 424);
  soft.push(`M ${cowl},292 L ${aTop},292`, `M ${cowl},436 L ${aTop},436`);
  // hood creases converging toward the nose
  soft.push(
    `M ${px(+cowl - 6)},322 L 312,336`,
    `M ${px(+cowl - 6)},406 L 312,392`,
  );
  // shark-fin antenna near the rear of the roof
  const fin = sedan ? planX(560) : planX(516);
  decor.push(`M ${fin},358 l 10,6 l -10,6 Z`);
  if (!sedan) {
    // bed inner box + floor ribs
    const bx0 = planX(600), bx1 = planX(816);
    decor.push(`M ${bx0},300 L ${bx1},300 L ${bx1},428 L ${bx0},428 Z`);
    for (let x = +bx0 + 22; x < +bx1 - 8; x += 24) soft.push(`M ${px(x)},304 L ${px(x)},424`);
  }
  return { decor, soft };
}

function topZones(sedan: boolean): ZoneShape[] {
  const zones: ZoneShape[] = [];
  const y0 = T.topY, y1 = T.topY + T.bandH, y2 = T.botY - T.bandH, y3 = T.botY;
  const cowl = +planX(sedan ? 362 : 352);
  const aTop = +planX(sedan ? 452 : 424);
  const cRear = sedan ? +planX(590) : +planX(558); // roof rear edge
  const gRear = sedan ? +planX(646) : +planX(592); // rear-glass rear edge
  const doorF = +planX(sedan ? 366 : 364); // fender → front door
  const doorB = +planX(sedan ? 470 : 458); // B-pillar
  const doorR = +planX(sedan ? 580 : 585); // rear door → quarter/bedside
  const capF = T.noseX + 30; // front bumper cap depth
  const capR = T.tailX - 30;

  // center-body bands (bumper caps span full height)
  zones.push(
    path(
      "front-bumper",
      `M ${T.noseX},308 Q ${T.noseX},272 302,264 L ${capF},${y0} L ${capF},${y3} L 302,464 Q ${T.noseX},456 ${T.noseX},420 Z`,
      [capF, 262],
    ),
  );
  zones.push(
    path(
      "rear-bumper",
      `M ${T.tailX},304 Q ${T.tailX},270 698,264 L ${capR},${y0} L ${capR},${y3} L 698,464 Q ${T.tailX},458 ${T.tailX},424 Z`,
      [T.tailX, 262],
    ),
  );
  // hood with a bowed cowl edge
  zones.push(
    path(
      "hood",
      `M ${capF},${y1} L ${cowl},${y1} Q ${cowl + 14},364 ${cowl},${y2} L ${capF},${y2} Z`,
      [cowl, y1],
    ),
  );
  // windshield: both edges bowed toward the rear
  zones.push(
    path(
      "windshield",
      `M ${cowl},${y1} Q ${cowl + 14},364 ${cowl},${y2} L ${aTop},${y2} Q ${aTop + 10},364 ${aTop},${y1} Z`,
      [aTop, y1],
    ),
  );
  zones.push(
    path(
      "roof",
      `M ${aTop},${y1} Q ${aTop + 10},364 ${aTop},${y2} L ${cRear},${y2} Q ${cRear + 8},364 ${cRear},${y1} Z`,
      [cRear, y1],
    ),
  );
  zones.push(
    path(
      "rear-glass",
      `M ${cRear},${y1} Q ${cRear + 8},364 ${cRear},${y2} L ${gRear},${y2} Q ${gRear + 6},364 ${gRear},${y1} Z`,
      [gRear, y1],
    ),
  );
  if (sedan) {
    zones.push(rect("trunk", gRear, y1, capR - gRear, y2 - y1));
  } else {
    const bedEnd = +planX(820);
    zones.push(rect("bed", gRear, y1, bedEnd - gRear, y2 - y1));
    zones.push(rect("tailgate", bedEnd, y1, capR - bedEnd, y2 - y1));
  }

  // side bands — upper = LEFT, lower = RIGHT (unfolds toward each profile)
  const band = (
    zone: ZoneId,
    x0: number,
    x1: number,
    top: boolean,
  ): ZoneShape => rect(zone, x0, top ? y0 : y2, x1 - x0, T.bandH);

  const sideBands: Array<[string, number, number]> = [
    ["fender-f", capF, doorF],
    ["door-f", doorF, doorB],
    ["door-r", doorB, doorR],
  ];
  for (const [base, x0, x1] of sideBands) {
    zones.push(band(`${base}l` as ZoneId, x0, x1, true));
    zones.push(band(`${base}r` as ZoneId, x0, x1, false));
  }
  const rearBase = sedan ? "quarter" : "bedside";
  zones.push(band(`${rearBase}-l` as ZoneId, doorR, capR, true));
  zones.push(band(`${rearBase}-r` as ZoneId, doorR, capR, false));

  // mirrors protrude beyond the body at the A-pillar
  zones.push(rect("mirror-l", doorF - 6, y0 - 13, 17, 12, 2));
  zones.push(rect("mirror-r", doorF - 6, y3 + 1, 17, 12, 2));

  return zones;
}

/* =====================================================================
 * FRONT and REAR faces — authored in place (front x 30..250, rear mirrored
 * about the sheet center so REAR keeps photographic left/right truth:
 * viewer-left is the car's RIGHT on the front face, but the car's LEFT on
 * the rear face.
 * =================================================================== */

type Face = { decor: string[]; soft: string[]; zones: ZoneShape[] };

/**
 * Shared face frame: a tapered greenhouse (narrower glass atop the body via
 * raked A/C-pillars) over a full-width lower body — real car proportions
 * (body ≈ 184 wide × ≈ 145 tall before the tires) instead of the mockup's
 * box. Both faces and both body types reuse it with different metrics.
 */
type FaceMetrics = {
  cx: number;
  halfW: number; // body half-width
  crownY: number; // roof crown (highest point)
  glassY: number; // glass top corners
  beltY: number; // shoulder/belt line
  bmpBottom: number; // bumper lower edge
  glassInset: number; // greenhouse inset from the body side
};

function faceFrame(m: FaceMetrics): { outline: string; tires: string[] } {
  const { cx, halfW, crownY, glassY, beltY, bmpBottom } = m;
  const L = cx - halfW;
  const R = cx + halfW;
  const gL = L + m.glassInset;
  const gR = R - m.glassInset;
  const outline = [
    `M ${L},${beltY} L ${gL},${glassY + 2} Q ${cx},${crownY} ${gR},${glassY + 2} L ${R},${beltY}`,
    `L ${R + 2},${bmpBottom - 16} Q ${R + 2},${bmpBottom} ${R - 10},${bmpBottom}`,
    `L ${L + 10},${bmpBottom} Q ${L - 2},${bmpBottom} ${L - 2},${bmpBottom - 16} Z`,
  ].join(" ");
  const tires = [
    `M ${L + 12},${bmpBottom} v 18 q 0,6 6,6 h 13 q 6,0 6,-6 v -18`,
    `M ${R - 37},${bmpBottom} v 18 q 0,6 6,6 h 13 q 6,0 6,-6 v -18`,
  ];
  return { outline, tires };
}

function faceRoofAndGlass(
  m: FaceMetrics,
  glassZone: ZoneId,
  glassBottomY: number,
): ZoneShape[] {
  const { cx, halfW, crownY, glassY } = m;
  const gL = cx - halfW + m.glassInset;
  const gR = cx + halfW - m.glassInset;
  return [
    path(
      "roof",
      `M ${gL},${glassY + 2} Q ${cx},${crownY} ${gR},${glassY + 2} L ${gR - 4},${glassY + 8} Q ${cx},${crownY + 6} ${gL + 4},${glassY + 8} Z`,
      [gR - 4, crownY - 4],
    ),
    path(
      glassZone,
      `M ${gL + 4},${glassY + 9} Q ${cx},${crownY + 7} ${gR - 4},${glassY + 9} L ${gR + 8},${glassBottomY} L ${gL - 8},${glassBottomY} Z`,
      [gR - 2, glassY + 4],
    ),
  ];
}

function frontFace(sedan: boolean): Face {
  const m: FaceMetrics = {
    cx: 140,
    halfW: 92,
    crownY: sedan ? 274 : 270,
    glassY: sedan ? 282 : 278,
    beltY: sedan ? 318 : 314,
    bmpBottom: sedan ? 414 : 420,
    glassInset: sedan ? 28 : 24,
  };
  const L = m.cx - m.halfW;
  const R = m.cx + m.halfW;
  const hoodY1 = m.beltY + 18; // hood leading edge
  const lampY0 = hoodY1 + 4;
  const lampY1 = lampY0 + (sedan ? 17 : 22);
  const bmpY0 = sedan ? lampY1 + 8 : lampY1 + 14;
  const gHalf = sedan ? 40 : 46;

  const { outline, tires } = faceFrame(m);
  const decor: string[] = [outline, ...tires];
  const soft: string[] = [];
  const zones: ZoneShape[] = [];

  // A-pillar taper hints
  soft.push(
    `M ${L + m.glassInset},${m.glassY + 3} L ${L + 3},${m.beltY - 2}`,
    `M ${R - m.glassInset},${m.glassY + 3} L ${R - 3},${m.beltY - 2}`,
  );
  // wipers
  soft.push(
    `M ${m.cx - 34},${m.beltY - 4} l 24,-9`,
    `M ${m.cx - 2},${m.beltY - 4} l 24,-9`,
  );
  // hood crown crease
  soft.push(`M ${L + 16},${hoodY1 - 3} Q ${m.cx},${m.beltY + 5} ${R - 16},${hoodY1 - 3}`);
  // grille slats + emblem
  const gY1 = sedan ? bmpY0 - 4 : lampY1 + 10;
  for (let i = 1; i <= (sedan ? 2 : 3); i++) {
    const y = px(lampY0 + ((gY1 - lampY0) * i) / (sedan ? 3 : 4));
    soft.push(`M ${m.cx - gHalf + 8},${y} L ${m.cx + gHalf - 8},${y}`);
  }
  decor.push(`M ${m.cx - 5},${px((lampY0 + gY1) / 2)} h 10`);
  // plate recess + lower intake + fog recesses
  soft.push(`M ${m.cx - 22},${bmpY0 + 6} h 44 v 14 h -44 Z`);
  soft.push(`M ${L + 32},${m.bmpBottom - 17} h ${R - L - 64} v 9 h ${-(R - L - 64)} Z`);
  soft.push(
    `M ${L + 11},${bmpY0 + 24} h 17 v 10 h -17 Z`,
    `M ${R - 28},${bmpY0 + 24} h 17 v 10 h -17 Z`,
  );

  zones.push(...faceRoofAndGlass(m, "windshield", m.beltY - 2));
  zones.push(poly("hood", [
    [L + 1, m.beltY],
    [R - 1, m.beltY],
    [R + 1, hoodY1],
    [L - 1, hoodY1],
  ]));
  // facing the car: viewer-left = the car's RIGHT side
  zones.push(poly("headlight-r", [
    [L - 1, lampY0],
    [m.cx - gHalf - 4, lampY0 + 2],
    [m.cx - gHalf - 8, lampY1],
    [L - 1, lampY1 + 3],
  ]));
  zones.push(poly("headlight-l", [
    [m.cx + gHalf + 4, lampY0 + 2],
    [R + 1, lampY0],
    [R + 1, lampY1 + 3],
    [m.cx + gHalf + 8, lampY1],
  ]));
  zones.push(poly("grille", [
    [m.cx - gHalf, lampY0],
    [m.cx + gHalf, lampY0],
    [m.cx + gHalf - 4, gY1],
    [m.cx - gHalf + 4, gY1],
  ]));
  zones.push(
    path(
      "front-bumper",
      `M ${L - 2},${bmpY0} L ${R + 2},${bmpY0} L ${R + 2},${m.bmpBottom - 16} Q ${R + 2},${m.bmpBottom} ${R - 10},${m.bmpBottom} L ${L + 10},${m.bmpBottom} Q ${L - 2},${m.bmpBottom} ${L - 2},${m.bmpBottom - 16} Z`,
      [R + 2, bmpY0 - 4],
    ),
  );
  zones.push(rect("mirror-r", L - 18, m.beltY - 18, 16, 12, 2));
  zones.push(rect("mirror-l", R + 2, m.beltY - 18, 16, 12, 2));

  return { decor, soft, zones };
}

function rearFace(sedan: boolean): Face {
  const m: FaceMetrics = {
    cx: 860,
    halfW: 92,
    crownY: sedan ? 274 : 270,
    glassY: sedan ? 282 : 278,
    beltY: sedan ? 314 : 310,
    bmpBottom: sedan ? 414 : 420,
    glassInset: sedan ? 30 : 24,
  };
  const L = m.cx - m.halfW;
  const R = m.cx + m.halfW;
  const deckY1 = sedan ? m.beltY + 34 : m.beltY + 66; // trunk lid / tailgate bottom
  const bmpY0 = sedan ? deckY1 + 8 : deckY1 + 6;

  const { outline, tires } = faceFrame(m);
  const decor: string[] = [outline, ...tires];
  const soft: string[] = [];
  const zones: ZoneShape[] = [];

  // C-pillar taper hints
  soft.push(
    `M ${L + m.glassInset},${m.glassY + 3} L ${L + 3},${m.beltY - 2}`,
    `M ${R - m.glassInset},${m.glassY + 3} L ${R - 3},${m.beltY - 2}`,
  );
  // plate recess (sedan: on the trunk lid · pickup: on the bumper)
  soft.push(
    sedan
      ? `M ${m.cx - 22},${m.beltY + 10} h 44 v 14 h -44 Z`
      : `M ${m.cx - 22},${bmpY0 + 7} h 44 v 14 h -44 Z`,
  );
  // exhaust hint
  soft.push(`M ${R - 33},${m.bmpBottom - 9} h 15 v 6 h -15 Z`);
  if (sedan) {
    // trunk shut lines dropping from the lamps
    soft.push(`M ${L + 44},${m.beltY + 2} L ${L + 44},${deckY1}`);
    soft.push(`M ${R - 44},${m.beltY + 2} L ${R - 44},${deckY1}`);
  } else {
    // tailgate emboss + handle
    soft.push(`M ${L + 18},${m.beltY + 30} L ${R - 18},${m.beltY + 30}`);
    decor.push(`M ${m.cx - 14},${m.beltY + 8} h 28 v 7 h -28 Z`);
  }

  zones.push(...faceRoofAndGlass(m, "rear-glass", m.beltY - 2));
  zones.push(
    sedan
      ? poly("trunk", [
          [L + 44, m.beltY],
          [R - 44, m.beltY],
          [R - 44, deckY1],
          [L + 44, deckY1],
        ])
      : poly("tailgate", [
          [L + 14, m.beltY],
          [R - 14, m.beltY],
          [R - 12, deckY1],
          [L + 12, deckY1],
        ]),
  );
  // photographic truth: viewer-left on the REAR face is the car's LEFT
  if (sedan) {
    zones.push(poly("taillight-l", [
      [L - 1, m.beltY],
      [L + 42, m.beltY + 2],
      [L + 38, m.beltY + 18],
      [L - 1, m.beltY + 16],
    ]));
    zones.push(poly("taillight-r", [
      [R - 42, m.beltY + 2],
      [R + 1, m.beltY],
      [R + 1, m.beltY + 16],
      [R - 38, m.beltY + 18],
    ]));
  } else {
    // pickup: upright lamps flanking the tailgate
    zones.push(rect("taillight-l", L - 1, m.beltY + 2, 14, 52, 2));
    zones.push(rect("taillight-r", R - 13, m.beltY + 2, 14, 52, 2));
  }
  zones.push(
    path(
      "rear-bumper",
      `M ${L - 2},${bmpY0} L ${R + 2},${bmpY0} L ${R + 2},${m.bmpBottom - 16} Q ${R + 2},${m.bmpBottom} ${R - 10},${m.bmpBottom} L ${L + 10},${m.bmpBottom} Q ${L - 2},${m.bmpBottom} ${L - 2},${m.bmpBottom - 16} Z`,
      [R + 2, bmpY0 - 4],
    ),
  );

  return { decor, soft, zones };
}

/* ---------- sheet composition ---------- */

const identity = (p: readonly [number, number]) => p;
/** Right profile: authored left-side geometry mirrored + dropped to the bottom band. */
const MIRROR = "matrix(-1 0 0 1 1000 522)";
const mirrorPoint = ([x, y]: readonly [number, number]) =>
  [1000 - x, y + 522] as const;

export function damageMapGeometry(bodyType: BodyType): ViewGeometry[] {
  const sedan = bodyType === "SEDAN";
  const prof = profileDecor(sedan);
  const top = topDecor(sedan);
  const front = frontFace(sedan);
  const rear = rearFace(sedan);

  return [
    {
      id: "left",
      transform: "",
      mapPoint: identity,
      bounds: { x: 140, y: 20, w: 720, h: 216 },
      caption: [500, 20],
      decor: prof.decor,
      decorSoft: prof.soft,
      zones: profileZones(sedan, "l"),
    },
    {
      id: "top",
      transform: "",
      mapPoint: identity,
      bounds: { x: 252, y: 240, w: 496, h: 254 },
      caption: [500, 254],
      decor: top.decor,
      decorSoft: top.soft,
      zones: topZones(sedan),
    },
    {
      id: "front",
      transform: "",
      mapPoint: identity,
      bounds: { x: 24, y: 248, w: 240, h: 252 },
      caption: [140, 510],
      decor: front.decor,
      decorSoft: front.soft,
      zones: front.zones,
    },
    {
      id: "rear",
      transform: "",
      mapPoint: identity,
      bounds: { x: 736, y: 248, w: 240, h: 252 },
      caption: [860, 510],
      decor: rear.decor,
      decorSoft: rear.soft,
      zones: rear.zones,
    },
    {
      id: "right",
      transform: MIRROR,
      mapPoint: mirrorPoint,
      bounds: { x: 140, y: 526, w: 720, h: 216 },
      caption: [500, 736],
      decor: prof.decor,
      decorSoft: prof.soft,
      zones: profileZones(sedan, "r"),
    },
  ];
}
