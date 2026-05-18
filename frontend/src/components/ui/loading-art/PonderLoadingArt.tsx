'use client';

import { useEffect, useRef } from 'react';

import type { LoadingArtProps } from './types';
import {
  applyFade,
  depthFactor,
  dotRadius,
  drawDot,
  setupCanvas,
  stepZ,
} from './physics';
import { resolveCssColorValue } from './utils';

const DEFAULT_SIZE = 280;

// ── Animation timing (time advances 0.04/frame at 30 fps ≈ 1.2 units/sec) ────
const CYCLE = 8.0;                        // full sequence ≈ 6.7 s
const BUBBLE_DELAYS = [0, 1.8, 3.5];     // when each bubble starts appearing
const FADE_IN_DURATION = 0.6;            // fade-in window per bubble
const GLOBAL_FADE_START = 6.0;           // all three start fading together
const GLOBAL_FADE_END = 8.0;             // end of cycle / fully gone

// ── Bubble layout (size-relative) ─────────────────────────────────────────────
// Smallest at bottom-left, largest at upper-right, ascending diagonally.
// Gaps computed so circles don't overlap (gap B0↔B1 ≈ 37 px, B1↔B2 ≈ 16 px at 280 px).
const BUBBLE_LAYOUT = [
  { relCx: 0.26, relCy: 0.82, relR: 0.055 },  // tiny
  { relCx: 0.46, relCy: 0.60, relR: 0.110 },  // medium
  { relCx: 0.66, relCy: 0.27, relR: 0.220 },  // large
] as const;

// ── Dot density constant (dots ≈ k × r²) ──────────────────────────────────────
const DOT_DENSITY = 2.0;
// Fraction of dots seeded near the rim to give each circle a crisp edge
const RIM_FRACTION = 0.22;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface ThoughtDot {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  z: number;
  phase: number;
  bubbleIndex: number;
}

export function PonderLoadingArt({
  size = DEFAULT_SIZE,
  className,
  color = 'var(--color-accent-anchor)',
}: LoadingArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const anchorInk = resolveCssColorValue(color);
    const deviceScale = window.devicePixelRatio || 1;
    const fw = size;
    const fh = size;
    // ctx is verified non-null above; alias to avoid repeated non-null assertions
    const context = ctx;
    setupCanvas(canvas, context, fw, fh, deviceScale);

    const bubbles = BUBBLE_LAYOUT.map(({ relCx, relCy, relR }) => ({
      cx: relCx * size,
      cy: relCy * size,
      r: relR * size,
    }));

    // ── Seed dots ─────────────────────────────────────────────────────────────
    const dots: ThoughtDot[] = [];

    for (let bi = 0; bi < bubbles.length; bi++) {
      const { cx, cy, r } = bubbles[bi];
      const total = Math.max(200, Math.round(DOT_DENSITY * r * r));
      const rimCount = Math.round(total * RIM_FRACTION);

      for (let i = 0; i < total; i++) {
        const isRim = i < rimCount;
        // Rim dots cluster in the outer 15 % of the radius for a clear circle edge.
        // Interior dots use a power-law radius so density peaks at the centre.
        const dist = isRim
          ? r * (0.85 + Math.random() * 0.15)
          : r * Math.pow(Math.random(), 0.65);
        const angle = Math.random() * Math.PI * 2;
        const hx = cx + Math.cos(angle) * dist;
        const hy = cy + Math.sin(angle) * dist;

        dots.push({
          x: hx,
          y: hy,
          homeX: hx,
          homeY: hy,
          z: Math.random() * 2 - 1,
          phase: Math.random() * Math.PI * 2,
          bubbleIndex: bi,
        });
      }
    }

    let time = 0;
    let animFrameId: number | null = null;
    let lastFrameTime = 0;
    const frameInterval = 1000 / 30;

    function getBubbleAlpha(bi: number, tCycle: number): number {
      const tRel = tCycle - BUBBLE_DELAYS[bi];
      const appear = smoothstep(0, FADE_IN_DURATION, tRel);
      const globalFade = 1 - smoothstep(GLOBAL_FADE_START, GLOBAL_FADE_END, tCycle);
      return appear * globalFade;
    }

    function drawFrame() {
      applyFade(context, fw, fh, 0.16);
      context.fillStyle = anchorInk;

      const tCycle = time % CYCLE;
      const bubbleAlphas = bubbles.map((_, bi) => getBubbleAlpha(bi, tCycle));

      for (const dot of dots) {
        const bAlpha = bubbleAlphas[dot.bubbleIndex];
        if (bAlpha < 0.01) continue;

        // Gentle sinusoidal shimmer drift
        const driftAmp = size * 0.0007;
        dot.x += Math.sin(time * 0.9 + dot.phase) * driftAmp;
        dot.y += Math.cos(time * 0.7 + dot.phase * 1.3) * driftAmp;

        // Soft pull back to home prevents accumulation outside the circle
        dot.x += (dot.homeX - dot.x) * 0.045;
        dot.y += (dot.homeY - dot.y) * 0.045;

        // Independent z breathing drives opacity shimmer
        dot.z = stepZ(dot.z, time, dot.phase, 0, 0.22, 0.016);
        const df = depthFactor(dot.z);

        const opacity = Math.max(0.03, 0.42 * df * bAlpha);
        const radius = dotRadius(size, df, 600, 0.30);
        drawDot(context, dot.x, dot.y, radius, opacity);
      }

      context.globalAlpha = 1;
    }

    function animate(now: number) {
      if (!lastFrameTime) lastFrameTime = now;
      const delta = now - lastFrameTime;
      if (delta >= frameInterval) {
        time += 0.04;
        drawFrame();
        lastFrameTime = now - (delta % frameInterval);
      }
      animFrameId = window.requestAnimationFrame(animate);
    }

    drawFrame();
    animFrameId = window.requestAnimationFrame(animate);

    return () => {
      if (animFrameId !== null) window.cancelAnimationFrame(animFrameId);
      context.clearRect(0, 0, fw, fh);
    };
  }, [color, size]);

  return (
    <div
      className={className}
      style={{ width: size, height: size, backgroundColor: 'transparent' }}
    >
      <canvas
        ref={canvasRef}
        className="block"
        style={{ width: size, height: size, backgroundColor: 'transparent' }}
      />
    </div>
  );
}
