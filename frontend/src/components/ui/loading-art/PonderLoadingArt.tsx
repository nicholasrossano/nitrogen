'use client';

import { useEffect, useRef } from 'react';

import type { LoadingArtProps } from './types';
import {
  depthFactor,
  dotRadius,
  drawDot,
  setupCanvas,
  stepZ,
} from './physics';
import { resolveCssColorValue } from './utils';

const DEFAULT_SIZE = 280;

// ── Animation timing (time advances 0.04/frame at 30 fps ≈ 1.2 units/sec) ────
const CYCLE = 8.0;
const BUBBLE_DELAYS = [0, 1.8, 3.5];
const FADE_IN_DURATION = 0.55;
const GLOBAL_FADE_START = 6.0;
const GLOBAL_FADE_END = 8.0;

// ── Bubble layout ─────────────────────────────────────────────────────────────
// Conventional thought-bubble direction: tiny at bottom-right, large at upper-left.
const BUBBLE_LAYOUT = [
  { relCx: 0.74, relCy: 0.78, relR: 0.055 },  // tiny  (bottom-right)
  { relCx: 0.54, relCy: 0.58, relR: 0.110 },  // medium (centre)
  { relCx: 0.34, relCy: 0.27, relR: 0.220 },  // large  (upper-left)
] as const;

// Fraction of dots seeded near the rim — higher than typical arts so the circle
// boundary reads clearly without requiring a solid filled disc.
const RIM_FRACTION = 0.48;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface ThoughtDot {
  // Positions are fixed — no drift accumulates, so clearRect gives crisp dots.
  readonly x: number;
  readonly y: number;
  z: number;
  readonly phase: number;
  readonly bubbleIndex: number;
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
    const context = ctx;
    setupCanvas(canvas, context, fw, fh, deviceScale);

    const bubbles = BUBBLE_LAYOUT.map(({ relCx, relCy, relR }) => ({
      cx: relCx * size,
      cy: relCy * size,
      r:  relR  * size,
    }));

    // ── Seed dots ─────────────────────────────────────────────────────────────
    // Same density as the rest of the art family (≈ 2 × r²) so dot size matches.
    // Nearly half the dots land on the rim, giving a clear circular outline;
    // radial jitter on rim dots (85–110 % of r) keeps the shape organic, not
    // a ruler-drawn circle.
    const dots: ThoughtDot[] = [];

    for (let bi = 0; bi < bubbles.length; bi++) {
      const { cx, cy, r } = bubbles[bi];
      const total    = Math.max(300, Math.round(2.0 * r * r));
      const rimCount = Math.round(total * RIM_FRACTION);

      for (let i = 0; i < total; i++) {
        const isRim = i < rimCount;
        const angle = Math.random() * Math.PI * 2;
        const dist = isRim
          // Rim: slight radial jitter for organic edge
          ? r * (0.85 + Math.random() * 0.25)
          // Interior: power-law so centre is a touch denser, capped inside rim
          : r * Math.pow(Math.random(), 0.75) * 0.84;

        dots.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
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
      // clearRect instead of destination-out: every dot is drawn crisp each frame
      // with no accumulated smearing from previous frames.
      context.clearRect(0, 0, fw, fh);
      context.fillStyle = anchorInk;

      const tCycle = time % CYCLE;
      const bubbleAlphas = bubbles.map((_, bi) => getBubbleAlpha(bi, tCycle));

      for (const dot of dots) {
        const bAlpha = bubbleAlphas[dot.bubbleIndex];
        if (bAlpha < 0.01) continue;

        // z breathes independently — drives opacity and size shimmer.
        // Positions are immutable so dots never drift or smear.
        dot.z = stepZ(dot.z, time, dot.phase, 0, 0.22, 0.016);
        const df = depthFactor(dot.z);

        const opacity = Math.max(0.03, 0.40 * df * bAlpha);
        const radius  = dotRadius(size, df, 800, 0.32);
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
