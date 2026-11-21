import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { FONT } from "./font.ts";

const W = 1024, H = 1024;
const buf = new Float32Array(W * H * 3);

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function setPx(x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
}
function blend(x: number, y: number, r: number, g: number, b: number, a: number) {
  if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = mix(buf[i], r, a);
  buf[i + 1] = mix(buf[i + 1], g, a);
  buf[i + 2] = mix(buf[i + 2], b, a);
}

// ---------- hashes ----------
function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return mix(hash2(i, 7), hash2(i + 1, 7), u);
}
function fbm(x: number, oct = 5): number {
  let v = 0, amp = 0.5, freq = 1;
  for (let k = 0; k < oct; k++) { v += amp * vnoise(x * freq); freq *= 2; amp *= 0.5; }
  return v;
}

const HORIZON = 648;

// ---------- palette ----------
const pSky: [number, number, number][] = [
  [16, 26, 54], [46, 52, 92], [116, 88, 118], [206, 130, 104], [247, 190, 132],
];
function skyAt(t: number): [number, number, number] {
  const knots = [0, 0.38, 0.62, 0.85, 1];
  for (let k = 0; k < knots.length - 1; k++) {
    if (t <= knots[k + 1]) {
      const u = (t - knots[k]) / (knots[k + 1] - knots[k]);
      const a = pSky[k], b = pSky[k + 1];
      return [mix(a[0], b[0], u), mix(a[1], b[1], u), mix(a[2], b[2], u)];
    }
  }
  return pSky[4];
}

// sky with ordered dither
for (let y = 0; y < HORIZON; y++) {
  const c = skyAt(y / HORIZON);
  for (let x = 0; x < W; x++) {
    const d = (hash2(x, y) - 0.5) * 2.2;
    setPx(x, y, c[0] + d, c[1] + d, c[2] + d);
  }
}

// ---------- stars ----------
for (let s = 0; s < 1400; s++) {
  const x = Math.floor(hash2(s, 1) * W);
  const y = Math.floor(hash2(s, 2) * 330 * hash2(s, 3) + hash2(s, 4) * 40);
  const b = 0.25 + hash2(s, 5) * 0.75;
  const fade = clamp(1 - y / 400);
  blend(x, y, 255, 248, 232, b * fade * 0.85);
  if (b > 0.85) { blend(x + 1, y, 255, 248, 232, b * fade * 0.3); blend(x, y + 1, 255, 248, 232, b * fade * 0.3); }
}

// ---------- sun ----------
const sunX = 656, sunY = 470, sunR = 62;
for (let y = sunY - 300; y < sunY + 300; y++) {
  for (let x = sunX - 300; x < sunX + 300; x++) {
    const d = Math.hypot(x - sunX, y - sunY);
    if (d > 300) continue;
    blend(x, y, 255, 186, 120, Math.pow(1 - d / 300, 2.4) * 0.80);
    if (d < sunR + 1.2) {
      const e = clamp((sunR + 1.2 - d) / 1.8);
      blend(x, y, 255, 243, 208, e);
    }
  }
}

// ---------- horizon haze ----------
for (let y = HORIZON - 120; y < HORIZON + 12; y++) {
  const t = clamp((y - (HORIZON - 120)) / 132);
  for (let x = 0; x < W; x++) blend(x, y, 255, 214, 168, t * 0.30);
}

// ---------- mountain ridges (fixed: fresh colour per pixel) ----------
type Ridge = { base: number; amp: number; freq: number; col: [number, number, number]; snow: boolean; phase: number };
const ridges: Ridge[] = [
  { base: HORIZON - 210, amp: 168, freq: 0.0032, col: [96, 96, 138], snow: true, phase: 0 },
  { base: HORIZON - 142, amp: 140, freq: 0.0047, col: [70, 72, 112], snow: true, phase: 37 },
  { base: HORIZON - 76, amp: 112, freq: 0.0067, col: [46, 50, 86], snow: false, phase: 83 },
  { base: HORIZON - 14, amp: 88, freq: 0.0091, col: [27, 31, 58], snow: false, phase: 139 },
];
for (const rg of ridges) {
  for (let x = 0; x < W; x++) {
    const n = fbm((x + rg.phase) * rg.freq);
    const peak = rg.base - n * rg.amp;
    const y0 = Math.max(0, Math.floor(peak));
    for (let y = y0; y < HORIZON; y++) {
      let r = rg.col[0], g = rg.col[1], b = rg.col[2];
      const fade = clamp((y - y0) / Math.max(1, HORIZON - y0)) * 0.50;
      r = mix(r, 236, fade * 0.34);
      g = mix(g, 176, fade * 0.30);
      b = mix(b, 140, fade * 0.24);
      const lit = clamp(1 - Math.abs(x - sunX) / 780) * 0.75;
      r = mix(r, 255, lit * 0.34);
      g = mix(g, 224, lit * 0.27);
      b = mix(b, 180, lit * 0.16);
      if (rg.snow && y < y0 + 30) {
        const s = clamp(1 - (y - y0) / 30) * (0.55 + lit * 0.45);
        r = mix(r, 250, s); g = mix(g, 244, s); b = mix(b, 236, s);
      }
      setPx(x, y, r, g, b);
    }
  }
}

// ---------- water ----------
for (let y = HORIZON; y < H; y++) {
  const t = (y - HORIZON) / (H - HORIZON);
  const base = [
    mix(126, 14, Math.pow(t, 0.55)),
    mix(140, 22, Math.pow(t, 0.55)),
    mix(158, 40, Math.pow(t, 0.55)),
  ];
  for (let x = 0; x < W; x++) {
    const wave = Math.sin((y * 2.1 + Math.sin(x * 0.009) * 26) * 0.075) * 0.5 + 0.5;
    const j = (fbm(x * 0.028 + y * 0.19, 3) - 0.5) * 0.30;
    const k = 1 + j + wave * 0.16 * (1 - t);
    const d = (hash2(x, y) - 0.5) * 2.0;
    setPx(x, y, base[0] * k + d, base[1] * k + d, base[2] * k + d);
  }
}

// sun glitter path
for (let y = HORIZON; y < H; y++) {
  const t = (y - HORIZON) / (H - HORIZON);
  const halfW = 22 + t * 190;
  const strength = Math.pow(1 - t, 1.5) * 0.95;
  const cx = sunX + Math.sin(y * 0.19) * 14 * t;
  for (let x = Math.floor(cx - halfW); x < cx + halfW; x++) {
    const d = Math.abs(x - cx) / halfW;
    const fall = Math.pow(clamp(1 - d), 1.6);
    const shimmer = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(y * 0.62 + x * 0.05), 2);
    blend(x, y, 255, 216, 166, fall * strength * shimmer * 0.85);
  }
}

// ridge reflections
for (const rg of ridges.slice(1)) {
  for (let x = 0; x < W; x++) {
    const n = fbm((x + rg.phase) * rg.freq);
    const depth = HORIZON - (rg.base - n * rg.amp);
    const len = Math.floor(depth * 0.5);
    for (let k = 1; k < len; k++) {
      const y = HORIZON + k;
      if (y >= H) break;
      const a = (1 - k / len) * 0.26;
      const wob = Math.sin(k * 0.5 + x * 0.04) * 3.2;
      blend(Math.floor(x + wob), y, rg.col[0] * 0.55, rg.col[1] * 0.55, rg.col[2] * 0.65, a);
    }
  }
}

// ---------- pines ----------
function pine(cx: number, baseY: number, h: number, col: [number, number, number]) {
  const layers = 9;
  for (let l = 0; l < layers; l++) {
    const t = l / layers;
    const y = baseY - h * t;
    const halfW = h * 0.26 * (1 - t) + 4;
    const th = h / layers + 1.5;
    for (let yy = Math.floor(y - th); yy <= y; yy++) {
      for (let x = Math.floor(cx - halfW); x <= cx + halfW; x++) setPx(x, yy, col[0], col[1], col[2]);
    }
  }
  for (let y = baseY - h * 0.10; y < baseY; y++)
    for (let x = cx - 4; x <= cx + 4; x++) setPx(x, y, col[0], col[1], col[2]);
}
const fg: [number, number, number] = [9, 12, 22];
for (let px = -8; px < 300; px += 40 + hash2(px, 11) * 34) {
  pine(px, 955 + hash2(px, 12) * 45, 150 + hash2(px, 13) * 150, fg);
}
for (let px = 790; px < 1045; px += 42 + hash2(px, 14) * 30) {
  pine(px, 972 + hash2(px, 15) * 42, 140 + hash2(px, 16) * 140, fg);
}

// ---------- boat ----------
(function () {
  const bx = 494, by = 806;
  for (let x = -44; x <= 44; x++) {
    const yy = by + Math.abs(x) * 0.15;
    for (let y = Math.floor(yy); y < yy + 8; y++) setPx(bx + x, y, 7, 9, 17);
  }
  for (let x = -2; x <= 2; x++) for (let y = by - 58; y < by; y++) setPx(bx + x, y, 7, 9, 17);
  for (let y = by - 54; y < by - 6; y++) {
    const w = Math.floor((by - 6 - y) * 0.40);
    for (let x = 2; x < 2 + w; x++) blend(bx + x, y, 238, 232, 216, 0.88);
  }
})();

// ---------- poster frame ----------
const FRAME = 42;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inX = x >= FRAME && x < W - FRAME, inY = y >= FRAME && y < H - FRAME;
    if (!inX && !inY) continue;
    if (!inX) for (let d = 0; d < 2; d++) { /* edge */
      const i = (y * W + x) * 3; buf[i] *= 0.0; buf[i + 1] *= 0.0; buf[i + 2] *= 0.0;
    }
  }
}
// solid frame + inner keyline
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (edge < FRAME) setPx(x, y, 248, 242, 229);
    else if (edge < FRAME + 3) setPx(x, y, 24, 28, 42);
  }
}

// ---------- typography ----------
function drawChar(ch: string, x0: number, y0: number, s: number, col: [number, number, number], alpha = 1) {
  const g = FONT[ch] ?? FONT[" "];
  for (let row = 0; row < 7; row++) {
    for (let cIdx = 0; cIdx < 5; cIdx++) {
      if (g[row][cIdx] !== "1") continue;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          blend(x0 + cIdx * s + dx, y0 + row * s + dy, col[0], col[1], col[2], alpha);
        }
      }
    }
  }
}
function textWidth(str: string, s: number, track: number) {
  return str.length * (5 * s + track) - track;
}
function drawText(str: string, cx: number, y0: number, s: number, track: number, col: [number, number, number], alpha = 1) {
  let x = Math.round(cx - textWidth(str, s, track) / 2);
  for (const ch of str) { drawChar(ch, x, y0, s, col, alpha); x += 5 * s + track; }
}

const ink: [number, number, number] = [16, 19, 32];
const paper: [number, number, number] = [250, 244, 231];

// title plate
const plateTop = 676, plateH = 306;
for (let y = plateTop; y < plateTop + plateH; y++) {
  const t = clamp((y - plateTop) / 40);
  for (let x = FRAME; x < W - FRAME; x++) {
    const edgeFade = clamp(Math.min(x - FRAME, W - FRAME - 1 - x) / 26);
    blend(x, y, paper[0], paper[1], paper[2], 0.965 * t * (0.25 + 0.75 * edgeFade));
  }
}
// ink footer band inside the plate
const bandTop = plateTop + 236;
for (let y = bandTop; y < plateTop + plateH; y++) {
  for (let x = FRAME; x < W - FRAME; x++) setPx(x, y, 20, 24, 38);
}

// hairline rules
for (let x = FRAME + 60; x < W - FRAME - 60; x++) {
  blend(x, plateTop + 18, ink[0], ink[1], ink[2], 0.55);
  blend(x, plateTop + plateH - 22, ink[0], ink[1], ink[2], 0.55);
}

drawText("VESPERHOLM", W / 2, plateTop + 42, 12, 11, ink, 0.97);
drawText("THE LAST FJORD OF THE NORTH", W / 2, plateTop + 140, 3, 6, ink, 0.80);
drawText("A PLACE THAT ISN\'T THERE", W / 2, plateTop + 168, 2, 4, ink, 0.55);

// top eyebrow
drawText("EXPEDITION 66 N", W / 2, FRAME + 34, 3, 7, paper, 0.92);

// bottom credit
drawText("MAKE·FUN", W / 2, bandTop + 26, 3, 7, paper, 0.92);

// ---------- grain + vignette ----------
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    const v = clamp(1 - Math.max(0, d - 0.62) * 1.15);
    const i = (y * W + x) * 3;
    const onPlate = y >= plateTop && y < plateTop + plateH && x >= FRAME && x < W - FRAME;
    const g = onPlate ? 0 : (hash2(x * 3 + 11, y * 7 + 5) - 0.5) * 9;
    buf[i] = clamp((buf[i] * v + g) / 255) * 255;
    buf[i + 1] = clamp((buf[i + 1] * v + g) / 255) * 255;
    buf[i + 2] = clamp((buf[i + 2] * v + g) / 255) * 255;
  }
}

// ---------- write PNG ----------
const rgb = Buffer.alloc(W * H * 3);
for (let i = 0; i < rgb.length; i++) rgb[i] = clamp(buf[i] / 255) * 255;

function crc32(b: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) {
    c = (crc ^ b[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encode(src: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    src.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
let out = encode(rgb);
if (out.length > 1048576) {
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(rgb[i] / 17) * 17;
  out = encode(rgb);
}
mkdirSync("/output", { recursive: true });
writeFileSync("/output/entry.png", out);
