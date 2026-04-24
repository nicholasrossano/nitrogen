'use client';

import { useEffect, useRef } from 'react';

import type { LoadingArtProps } from './types';
import {
  applyFade,
  computeDrift,
  depthFactor,
  dotRadius,
  drawDot,
  setupCanvas,
  stepConvergence,
  stepZ,
} from './physics';
import { resolveCssColorValue } from './utils';

const DEFAULT_SIZE = 360;

// Golden angle: successive seeds in a Fermat/phyllotaxis spiral are always
// separated by this angle, giving the maximally-uniform packing found in
// real sunflower heads.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 137.508°

// 21 is the Fibonacci number just below 34. Sunflowers always show a Fibonacci
// petal count — 21 gives a nice full crown without being too tight.
const PETAL_COUNT = 21;

interface SunDot {
  x: number;
  y: number;
  z: number;
  phase: number;
  homeX: number;
  homeY: number;
  foldX: number;
  foldY: number;
  part: 'disk' | 'petal';
  radialBias: number;
  swayAmplitude: number;
  swayPhase: number;
  convergencePhase: number;
  convergenceSpeed: number;
}

export function SunflowerLoadingArt({
  size = DEFAULT_SIZE,
  className,
  color = 'var(--color-accent-anchor)',
}: LoadingArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ctx = context;

    const anchorInk = resolveCssColorValue(color);
    const deviceScale = window.devicePixelRatio || 1;
    const fw = size;
    const fh = size;
    const cx = fw / 2;
    const cy = fh / 2 + size * 0.022;

    setupCanvas(canvas, ctx, fw, fh, deviceScale);

    const diskR = size * 0.185;
    const petalLen = size * 0.140;
    const petalHalfW = size * 0.052;

    const totalDots = Math.max(10000, Math.round((fw * fh) / 8.5));
    const diskDots = Math.round(totalDots * 0.55);
    const petalDots = totalDots - diskDots;
    const dotsPerPetal = Math.round(petalDots / PETAL_COUNT);

    const dots: SunDot[] = [];

    // ── Disk: Fermat/phyllotaxis spiral ─────────────────────────────────────
    // Direct sampling — zero rejection. Seed n lives at (sqrt(n/N), n*φ) in
    // polar coordinates, which places it in the n-th cell of the Voronoi
    // partition on the disk. Density is perfectly uniform by construction.
    for (let n = 0; n < diskDots; n++) {
      const theta = n * GOLDEN_ANGLE;
      const rNorm = Math.sqrt(n / diskDots);
      const r = rNorm * diskR * (0.95 + Math.random() * 0.07);
      const homeX = cx + Math.cos(theta) * r;
      const homeY = cy + Math.sin(theta) * r;
      dots.push({
        x: homeX, y: homeY,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX, homeY,
        foldX: cx, foldY: cy,
        part: 'disk',
        radialBias: rNorm,
        swayAmplitude: size * 0.0009,
        swayPhase: Math.random() * Math.PI * 2,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.011 + Math.random() * 0.010,
      });
    }

    // ── Petals: 21 tapered oval clusters ────────────────────────────────────
    // Parametric sampling: t ∈ [0,1] along the petal axis, width = sin(πt)*max.
    // No rejection loop — every sample lands inside the petal.
    for (let p = 0; p < PETAL_COUNT; p++) {
      const petalAngle = (p / PETAL_COUNT) * Math.PI * 2;
      const cosA = Math.cos(petalAngle);
      const sinA = Math.sin(petalAngle);
      const attachX = cx + cosA * diskR;
      const attachY = cy + sinA * diskR;
      const midX = cx + cosA * (diskR + petalLen * 0.5);
      const midY = cy + sinA * (diskR + petalLen * 0.5);

      for (let d = 0; d < dotsPerPetal; d++) {
        const t = Math.random();
        const hw = Math.sin(Math.PI * t) * petalHalfW;
        const along = (t - 0.5) * petalLen;
        const across = (Math.random() * 2 - 1) * hw;
        const homeX = midX + cosA * along - sinA * across;
        const homeY = midY + sinA * along + cosA * across;
        const rNorm = Math.min(1, Math.hypot(homeX - cx, homeY - cy) / (diskR + petalLen));
        dots.push({
          x: homeX, y: homeY,
          z: Math.random() * 2 - 1,
          phase: Math.random() * Math.PI * 2,
          homeX, homeY,
          foldX: attachX, foldY: attachY,
          part: 'petal',
          radialBias: rNorm,
          swayAmplitude: size * (0.006 + rNorm * 0.017),
          swayPhase: Math.random() * Math.PI * 2 + petalAngle,
          convergencePhase: Math.random() * Math.PI * 2,
          convergenceSpeed: 0.013 + Math.random() * 0.012,
        });
      }
    }

    let time = 0;
    let animId: number | null = null;
    let lastFt = 0;
    const fi = 1000 / 12;

    function draw() {
      applyFade(ctx, fw, fh, 0.15);
      ctx.fillStyle = anchorInk;

      for (const dot of dots) {
        const { cycle, isConverging, nextPhase } = stepConvergence(
          dot.convergencePhase,
          dot.convergenceSpeed,
        );
        dot.convergencePhase = nextPhase;

        if (isConverging) {
          // Inhale: disk seeds collapse to center; petals fold back to disk edge.
          const dist = Math.hypot(dot.x - dot.foldX, dot.y - dot.foldY);
          const spd = dot.part === 'petal'
            ? 0.034 * cycle * Math.min(1, dist / (size * 0.038))
            : 0.026 * cycle * Math.min(1, dist / (size * 0.022));
          dot.x += (dot.foldX - dot.x) * spd;
          dot.y += (dot.foldY - dot.y) * spd;
        } else {
          // Exhale: spring back to phyllotaxis home + gentle nodding sway.
          const sx = Math.sin(time * 0.60 + dot.swayPhase) * dot.swayAmplitude;
          const sy = Math.cos(time * 0.42 + dot.swayPhase) * dot.swayAmplitude * 0.28;
          const tx = dot.homeX + sx;
          const ty = dot.homeY + sy;
          const spd = dot.part === 'petal'
            ? 0.028 * Math.abs(cycle)
            : 0.021 * Math.abs(cycle);
          dot.x += (tx - dot.x) * spd;
          dot.y += (ty - dot.y) * spd;

          const dx = dot.x - cx;
          const dy = dot.y - cy;
          const dm = computeDrift(
            Math.atan2(dy, dx), dot.z, time, dot.phase, 2, 3, 0.0036, 0.0026,
          );
          dot.x += dx * dm;
          dot.y += dy * dm;
        }

        dot.z = stepZ(dot.z, time, dot.phase, dot.radialBias + Math.abs(cycle), 0.18, 0.012);
        const df = depthFactor(dot.z, dot.part === 'disk' ? 0.46 : 0.54);
        const op = dot.part === 'petal'
          ? Math.max(0.022, 0.29 * Math.abs(cycle) + 0.055 * df)
          : Math.max(0.030, 0.34 * Math.abs(cycle) + 0.065 * df);
        const r = dot.part === 'petal'
          ? dotRadius(size, df, 950, 0.27)
          : dotRadius(size, df, 870, 0.30);
        drawDot(ctx, dot.x, dot.y, r, op);
      }

      ctx.globalAlpha = 1;
    }

    function animate(t: number) {
      if (!lastFt) lastFt = t;
      const delta = t - lastFt;
      if (delta >= fi) {
        time += 0.055;
        draw();
        lastFt = t - (delta % fi);
      }
      animId = window.requestAnimationFrame(animate);
    }

    draw();
    animId = window.requestAnimationFrame(animate);

    return () => {
      if (animId !== null) window.cancelAnimationFrame(animId);
      ctx.clearRect(0, 0, fw, fh);
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
