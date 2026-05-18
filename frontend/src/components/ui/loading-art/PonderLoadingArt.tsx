'use client';

import { useEffect, useRef } from 'react';

import type { LoadingArtProps } from './types';
import { setupCanvas, stepZ, depthFactor } from './physics';
import { resolveCssColorValue } from './utils';

const DEFAULT_SIZE = 280;

// ── Animation timing (time advances 0.04/frame at 30 fps ≈ 1.2 units/sec) ────
const CYCLE = 8.0;                      // full sequence ≈ 6.7 s
const BUBBLE_DELAYS = [0, 1.8, 3.5];   // when each bubble begins to appear
const FADE_IN_DURATION = 0.55;         // fade-in window per bubble
const GLOBAL_FADE_START = 6.0;         // all bubbles start fading together
const GLOBAL_FADE_END = 8.0;           // end of cycle

// ── Bubble layout ─────────────────────────────────────────────────────────────
// Conventional thought-bubble direction: smallest dot at bottom-right (near the
// thinker), largest cloud at upper-left.  Gaps at size=280: B0↔B1 ≈ 33px, B1↔B2 ≈ 11px.
const BUBBLE_LAYOUT = [
  { relCx: 0.74, relCy: 0.78, relR: 0.055 },  // tiny  (bottom-right)
  { relCx: 0.54, relCy: 0.58, relR: 0.110 },  // medium (centre)
  { relCx: 0.34, relCy: 0.27, relR: 0.220 },  // large  (upper-left)
] as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface ThoughtDot {
  // Positions are fixed at seed time — no drift accumulates.
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
    // alias to narrow type — ctx is verified non-null above
    const context = ctx;
    setupCanvas(canvas, context, fw, fh, deviceScale);

    const bubbles = BUBBLE_LAYOUT.map(({ relCx, relCy, relR }) => ({
      cx: relCx * size,
      cy: relCy * size,
      r:  relR  * size,
    }));

    // ── Seed dots ─────────────────────────────────────────────────────────────
    // Few, visible-sized dots arranged mostly around the rim so each bubble reads
    // as a loose circle rather than a solid filled disc.
    //
    // Rim dots use stratified angular sampling (one per sector) + random jitter
    // on both angle and radius — this breaks the perfect-circle look while keeping
    // the shape clearly bubble-shaped.
    const dots: ThoughtDot[] = [];

    for (let bi = 0; bi < bubbles.length; bi++) {
      const { cx, cy, r } = bubbles[bi];

      // Rim count proportional to circumference so dot spacing stays consistent.
      const rimN = Math.max(18, Math.round(r * 1.5));
      for (let i = 0; i < rimN; i++) {
        const sectorAngle = (Math.PI * 2) / rimN;
        const baseAngle = i * sectorAngle;
        // Angular jitter: up to ±40 % of one sector width
        const angle = baseAngle + (Math.random() - 0.5) * sectorAngle * 0.8;
        // Radial jitter: 85–110 % of r so the rim is organic / not a perfect ring
        const dist = r * (0.85 + Math.random() * 0.25);
        dots.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          z: 0.2 + Math.random() * 0.8,   // rim dots start brighter
          phase: Math.random() * Math.PI * 2,
          bubbleIndex: bi,
        });
      }

      // Sparse interior — about 35 % of rim count, spread across the full disc.
      const interiorN = Math.max(6, Math.round(rimN * 0.35));
      for (let i = 0; i < interiorN; i++) {
        const angle = Math.random() * Math.PI * 2;
        // sqrt for uniform area distribution; cap at 75 % of r so there's a
        // clear gap between interior dots and the rim.
        const dist = r * Math.sqrt(Math.random()) * 0.75;
        dots.push({
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          z: Math.random() * 0.6 - 0.1,   // dimmer than rim
          phase: Math.random() * Math.PI * 2,
          bubbleIndex: bi,
        });
      }
    }

    // Individual dot radius — large enough to be clearly visible as discrete dots.
    const dotR = Math.max(1.0, size * 0.009);

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
      // Hard clear each frame — no destination-out smearing, dots stay crisp.
      context.clearRect(0, 0, fw, fh);
      context.fillStyle = anchorInk;

      const tCycle = time % CYCLE;
      const bubbleAlphas = bubbles.map((_, bi) => getBubbleAlpha(bi, tCycle));

      for (const dot of dots) {
        const bAlpha = bubbleAlphas[dot.bubbleIndex];
        if (bAlpha < 0.01) continue;

        // z-only breathing — dots stay in place, just twinkle in opacity and size.
        dot.z = stepZ(dot.z, time, dot.phase, 0, 0.22, 0.018);
        const df = depthFactor(dot.z);

        const radius  = Math.max(0.5, dotR * df);
        const opacity = Math.max(0.05, 0.65 * df * bAlpha);

        context.globalAlpha = opacity;
        context.beginPath();
        context.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
        context.fill();
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
