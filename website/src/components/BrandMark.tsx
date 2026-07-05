"use client";

/**
 * TERRYTORY brand mark — the connected double-R monogram.
 * Two R glyphs fused across a shared central spine (right half a clean R,
 * left half its mirror). Rendered in brand green with a soft glow and a
 * deterministic graffiti-style spray of overspray dots hugging the strokes.
 */

const GREEN = "#00e676";

// Small seeded PRNG so the spray pattern is stable across renders.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Sample a point somewhere along the monogram's strokes (local coords).
function sampleOnMark(rng: () => number): Pt {
  const r = rng();
  if (r < 0.3) return [0, -70 + 140 * rng()]; // shared spine
  if (r < 0.5) {
    const p = Math.PI * rng(); // right bowl
    return [36 * Math.sin(p), -34 - 36 * Math.cos(p)];
  }
  if (r < 0.7) {
    const p = Math.PI * rng(); // left bowl
    return [-36 * Math.sin(p), -34 - 36 * Math.cos(p)];
  }
  if (r < 0.85) return lerp([0, 2], [74, 70], rng()); // right leg
  return lerp([0, 2], [-74, 70], rng()); // left leg
}

// Approx. normal distribution for natural-looking jitter.
const gauss = (rng: () => number) => (rng() + rng() + rng() + rng() - 2) / 2;

const SPRAY = (() => {
  const rng = mulberry32(20260703);
  const dots: { x: number; y: number; r: number; o: number }[] = [];
  for (let i = 0; i < 74; i++) {
    const [px, py] = sampleOnMark(rng);
    dots.push({
      x: px + gauss(rng) * 10,
      y: py + gauss(rng) * 10,
      r: 0.7 + rng() * 2.6,
      o: 0.1 + rng() * 0.32,
    });
  }
  return dots;
})();

function Strokes({ w = 24, opacity = 1, filter }: { w?: number; opacity?: number; filter?: string }) {
  return (
    <g fill="none" stroke={GREEN} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} filter={filter}>
      <path d="M0,-70 L0,70" />
      <path d="M0,-70 A 36 36 0 0 1 0,2" />
      <path d="M0,2 L74,70" />
      <path d="M0,-70 A 36 36 0 0 0 0,2" />
      <path d="M0,2 L-74,70" />
    </g>
  );
}

export function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <svg
      viewBox="-100 -95 200 185"
      height={size}
      width={(size * 200) / 185}
      role="img"
      aria-label="Terrytory"
      style={{ flexShrink: 0, overflow: "visible" }}
    >
      <defs>
        <filter id="mk-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
        <filter id="mk-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
      </defs>
      <Strokes w={30} opacity={0.4} filter="url(#mk-glow)" />
      <g filter="url(#mk-soft)">
        {SPRAY.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={GREEN} opacity={d.o} />
        ))}
      </g>
      <Strokes w={24} />
    </svg>
  );
}
