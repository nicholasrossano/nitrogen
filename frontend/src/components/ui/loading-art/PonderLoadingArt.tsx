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

// ── Geometry: union of overlapping circular lobes ────────────────────────────
// Real cartoon thought bubbles are not blobs with sharp harmonics — they're a
// CLOUD OF OVERLAPPING CIRCLES.  Each lobe is a perfect disc.  Adjacent lobes
// overlap, so the union has smooth rounded scallops where they meet (the
// pointy "valleys" between rounded peaks).  No high-frequency sin/cos shapes.
//
// Cloud layout:
//   - 1 large core lobe
//   - 4 inner lobes filling the body so the cloud silhouette is roughly an
//     oblong / kidney shape
//   - 9 outer perimeter lobes giving the bumpy edge
//
// Tail layout:
//   - 1 medium oval, 1 small oval, descending toward bottom-right
interface Lobe {
  cx: number;
  cy: number;
  r: number;
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

    // ── Cloud construction ────────────────────────────────────────────────────
    const cloudCx = size * 0.42;
    const cloudCy = size * 0.40;
    const cloudRx = size * 0.32;   // half-width of the cloud bounding ellipse
    const cloudRy = size * 0.26;   // half-height

    const cloudLobes: Lobe[] = [];

    // Inner body lobes — overlapping discs that together form a soft oblong.
    cloudLobes.push({ cx: cloudCx, cy: cloudCy, r: size * 0.16 });
    cloudLobes.push({ cx: cloudCx - cloudRx * 0.40, cy: cloudCy + cloudRy * 0.05, r: size * 0.12 });
    cloudLobes.push({ cx: cloudCx + cloudRx * 0.42, cy: cloudCy - cloudRy * 0.05, r: size * 0.13 });
    cloudLobes.push({ cx: cloudCx - cloudRx * 0.10, cy: cloudCy - cloudRy * 0.40, r: size * 0.11 });
    cloudLobes.push({ cx: cloudCx + cloudRx * 0.05, cy: cloudCy + cloudRy * 0.45, r: size * 0.10 });

    // Outer perimeter lobes — 9 bumps around the bounding ellipse.  Each lobe
    // sits at angle θ from cloud centre at the ellipse boundary, with a radius
    // jittered slightly so bumps look natural rather than mechanical.
    const PERIMETER_BUMPS = 9;
    const seed = (i: number) => Math.sin(i * 12.9898) * 43758.5453;
    const rand1 = (i: number) => {
      const v = seed(i);
      return v - Math.floor(v); // 0..1 deterministic per-bump pseudo-random
    };
    for (let i = 0; i < PERIMETER_BUMPS; i++) {
      const θ = (i / PERIMETER_BUMPS) * Math.PI * 2 + 0.18; // small offset
      const sizeJitter = 0.85 + rand1(i) * 0.30;            // 0.85–1.15
      const radJitter  = 0.92 + rand1(i + 31) * 0.16;       // 0.92–1.08
      const lobeR = size * 0.085 * sizeJitter;
      // place lobe centres just inside the bounding ellipse so they overlap
      // with the inner body — gives smooth scallops around the perimeter.
      const px = cloudCx + cloudRx * 0.92 * Math.cos(θ) * radJitter;
      const py = cloudCy + cloudRy * 0.92 * Math.sin(θ) * radJitter;
      cloudLobes.push({ cx: px, cy: py, r: lobeR });
    }

    // ── Tail ovals (rendered as single circular lobes for simplicity) ─────────
    const tailLobes: Lobe[] = [
      { cx: size * 0.78, cy: size * 0.74, r: size * 0.060 },  // medium
      { cx: size * 0.88, cy: size * 0.86, r: size * 0.038 },  // small
    ];

    // ── Sample dots across all lobes ──────────────────────────────────────────
    // Sampling strategy: pick a lobe weighted by its area; sample uniformly in
    // a disc; outline-bias half the dots toward the rim so the cloud silhouette
    // reads clearly.  Lobe overlaps then naturally raise interior density.
    type Dot = { x: number; y: number; z: number; phase: number };
    const dots: Dot[] = [];

    // Family-standard density (matches Dahlia/Dandelion/Fern).
    const TOTAL_DOTS = Math.max(9000, Math.round((size * size) / 9));
    // Cloud carries the bulk of dots; tail ovals share the rest by area.
    const cloudArea = cloudLobes.reduce((s, l) => s + l.r * l.r, 0);
    const tailArea  = tailLobes.reduce((s, l) => s + l.r * l.r, 0);
    const cloudDotCount = Math.round(TOTAL_DOTS * cloudArea / (cloudArea + tailArea));
    const tailDotCount  = TOTAL_DOTS - cloudDotCount;

    function pickLobe(lobes: Lobe[]): Lobe {
      const totalArea = lobes.reduce((s, l) => s + l.r * l.r, 0);
      let pick = Math.random() * totalArea;
      for (const l of lobes) {
        pick -= l.r * l.r;
        if (pick <= 0) return l;
      }
      return lobes[lobes.length - 1];
    }

    function seedInLobes(lobes: Lobe[], n: number, outlineRatio: number) {
      const nOutline = Math.round(n * outlineRatio);
      for (let i = 0; i < n; i++) {
        const lobe = pickLobe(lobes);
        const angle = Math.random() * Math.PI * 2;
        // Outline dots sit in the outer 25 % of each lobe's radius, giving
        // a strong silhouette where lobes don't overlap with neighbours.
        // Interior dots use sqrt(random) for uniform area distribution.
        const distFrac = i < nOutline
          ? 0.78 + Math.random() * 0.22
          : Math.sqrt(Math.random());
        dots.push({
          x: lobe.cx + Math.cos(angle) * distFrac * lobe.r,
          y: lobe.cy + Math.sin(angle) * distFrac * lobe.r,
          z: Math.random() * 2 - 1,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    seedInLobes(cloudLobes, cloudDotCount, 0.45);
    seedInLobes(tailLobes, tailDotCount, 0.55);

    let time = 0;
    let animFrameId: number | null = null;
    let lastFrameTime = 0;
    const frameInterval = 1000 / 12;  // matches Dahlia/Fern frame rate

    function drawFrame() {
      // Family-standard destination-out fade: gives the soft pointillism halo
      // that Dahlia/Dandelion have, without smearing — works because dot
      // positions are stationary, so the fade just stabilises the alpha.
      applyFade(context, fw, fh, 0.15);
      context.fillStyle = anchorInk;

      for (const dot of dots) {
        // z-only breathing — positions are stationary, no drift.
        dot.z = stepZ(dot.z, time, dot.phase, 0, 0.18, 0.012);
        const df = depthFactor(dot.z);
        const opacity = Math.max(0.025, 0.34 + 0.05 * df);
        drawDot(context, dot.x, dot.y, dotRadius(size, df, 950, 0.3), opacity);
      }

      context.globalAlpha = 1;
    }

    function animate(now: number) {
      if (!lastFrameTime) lastFrameTime = now;
      const delta = now - lastFrameTime;
      if (delta >= frameInterval) {
        time += 0.055;
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
