import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

/**
 * Generated media for the presentation seed (scripts/seed-demo.ts). No photographs, no people,
 * no third-party audio: abstract artwork drawn from the approved palette (read from
 * apps/web/src/styles/palette.css, so it can never drift from the site) and short synthesized
 * beat loops. Deterministic: the same seed string always gives the same file.
 */

type RGB = [number, number, number];

function paletteColours(): Record<string, RGB> {
  const css = readFileSync(new URL('../../../web/src/styles/palette.css', import.meta.url), 'utf8');
  const out: Record<string, RGB> = {};
  for (const m of css.matchAll(/--p-([a-z0-9-]+):\s*#([0-9a-f]{6})\b/gi)) {
    const hex = m[2]!;
    out[m[1]!] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as RGB;
  }
  for (const k of ['base', 'raised', 'overlay', 'chip', 'control', 'accent', 'text-2', 'paper']) {
    if (!out[k]) throw new Error(`palette.css: --p-${k} not found`);
  }
  return out;
}

/** Small seeded PRNG (mulberry32) so artwork and loops are repeatable. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as RGB;

function encodePng(width: number, height: number, pixel: (x: number, y: number) => RGB): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Release artwork / banner: olive gradient, a soft disc and a lime waveform. */
export function artwork(seed: string, width = 800, height = 800): Buffer {
  const p = paletteColours();
  const r = rng(seed);
  const bars = 28 + Math.floor(r() * 20);
  const heights = Array.from(
    { length: bars },
    (_, i) => 0.15 + 0.7 * Math.abs(Math.sin(i * (0.3 + r() * 0.5) + r() * 3)) * (0.5 + r() * 0.5),
  );
  const cx = width * (0.3 + r() * 0.4);
  const cy = height * (0.25 + r() * 0.3);
  const radius = Math.min(width, height) * (0.22 + r() * 0.12);
  const band = { top: height * 0.62, bottom: height * 0.9 };
  const barW = width / bars;
  return encodePng(width, height, (x, y) => {
    let c = mix(p.base!, p.raised!, y / height);
    const d = Math.hypot(x - cx, y - cy);
    if (d < radius) c = mix(c, p.overlay!, 0.9 - (d / radius) * 0.5);
    if (Math.abs(d - radius) < 2) c = mix(c, p.control!, 0.8);
    if (y > band.top && y < band.bottom) {
      const i = Math.floor(x / barW);
      const within = x - i * barW;
      const mid = (band.top + band.bottom) / 2;
      const half = ((band.bottom - band.top) / 2) * heights[i]!;
      if (within > barW * 0.25 && within < barW * 0.75 && Math.abs(y - mid) < half) c = mix(p.accent!, p['text-2']!, i / bars / 3);
    }
    return c;
  });
}

/** Profile picture: concentric rings, no faces. */
export function avatar(seed: string, size = 400): Buffer {
  const p = paletteColours();
  const r = rng(seed);
  const rings = 3 + Math.floor(r() * 3);
  const tones = [p.chip!, p.control!, p.overlay!, p.accent!, p['text-2']!];
  const offset = Math.floor(r() * tones.length);
  return encodePng(size, size, (x, y) => {
    const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
    const i = Math.min(rings - 1, Math.floor(d * rings));
    const base = tones[(i + offset) % tones.length]!;
    return mix(base, p.base!, d > 1 ? 1 : d * 0.35);
  });
}

/**
 * A short synthesized loop (16-bit mono WAV): kick, log-drum style bass, hats and chord stabs.
 * Original sound, generated here; nothing is sampled.
 */
export function beatLoop(seed: string, { bpm = 112, bars = 4, root = 55 }: { bpm?: number; bars?: number; root?: number } = {}): Buffer {
  const r = rng(seed);
  const rate = 22_050;
  const step = (60 / bpm / 4) * rate; // sixteenth note, in samples
  const steps = bars * 16;
  const length = Math.ceil(steps * step);
  const out = new Float32Array(length);
  const kickAt = new Set([0, 4, 8, 12].filter(() => true));
  const logAt = Array.from({ length: 16 }, (_, i) => (i % 4 === 2 || r() < 0.22 ? 1 : 0));
  const scale = [0, 3, 5, 7, 10];
  const chord = [0, 3, 7].map((s) => root * 4 * 2 ** (s / 12));
  let noise = 0;
  for (let s = 0; s < steps; s++) {
    const start = Math.floor(s * step);
    const pos = s % 16;
    const add = (n: number, f: (t: number) => number) => {
      for (let i = 0; i < n && start + i < length; i++) out[start + i]! += f(i / rate);
    };
    if (kickAt.has(pos))
      add(rate * 0.35, (t) => Math.sin(2 * Math.PI * (45 * t + (60 * (1 - Math.exp(-t * 30))) / 30)) * Math.exp(-t * 9) * 0.9);
    if (logAt[pos]) {
      const f = root * 2 ** (scale[Math.floor(r() * scale.length)]! / 12);
      add(rate * 0.28, (t) => Math.sin(2 * Math.PI * f * (t + 0.02 * Math.exp(-t * 20))) * Math.exp(-t * 11) * 0.55);
    }
    if (pos % 2 === 1)
      add(rate * 0.04, (t) => {
        const white = r() * 2 - 1;
        const hp = white - noise;
        noise = white;
        return hp * Math.exp(-t * 90) * 0.12;
      });
    if (pos === 0 || pos === 10)
      add(rate * 0.5, (t) => chord.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t), 0) * Math.exp(-t * 4) * 0.08);
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const fade = rate * 0.05;
  const pcm = Buffer.alloc(44 + length * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(36 + length * 2, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); // PCM
  pcm.writeUInt16LE(1, 22); // mono
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    const env = Math.min(1, i / fade, (length - i) / fade);
    pcm.writeInt16LE(Math.round((out[i]! / (peak || 1)) * 0.85 * env * 32767), 44 + i * 2);
  }
  return pcm;
}
