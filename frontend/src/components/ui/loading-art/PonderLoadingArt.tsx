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

interface Dot {
  x: number;
  y: number;
  z: number;
  phase: number;
  homeX: number;
  homeY: number;
  foldX: number;
  foldY: number;
  breathOffset: number;
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

    // Outer perimeter lobes — closer/larger than before so they read as one
    // cloud body instead of a ring of separate circles.
    const PERIMETER_BUMPS = 10;
    const seed = (i: number) => Math.sin(i * 12.9898) * 43758.5453;
    const rand1 = (i: number) => {
      const v = seed(i);
      return v - Math.floor(v); // 0..1 deterministic per-bump pseudo-random
    };
    for (let i = 0; i < PERIMETER_BUMPS; i++) {
      const θ = (i / PERIMETER_BUMPS) * Math.PI * 2 + 0.18; // small offset
      const sizeJitter = 0.90 + rand1(i) * 0.20;            // 0.90–1.10
      const radJitter  = 0.94 + rand1(i + 31) * 0.12;       // 0.94–1.06
      const lobeR = size * 0.105 * sizeJitter;
      // Centres sit well inside the bounding ellipse: bumps overlap each other
      // and the body, producing rounded scallops without visible separate discs.
      const px = cloudCx + cloudRx * 0.74 * Math.cos(θ) * radJitter;
      const py = cloudCy + cloudRy * 0.74 * Math.sin(θ) * radJitter;
      cloudLobes.push({ cx: px, cy: py, r: lobeR });
    }

    // ── Tail ovals (rendered as single circular lobes for simplicity) ─────────
    const mediumTailLobes: Lobe[] = [
      { cx: size * 0.61, cy: size * 0.72, r: size * 0.060 },
    ];
    const smallTailLobes: Lobe[] = [
      { cx: size * 0.70, cy: size * 0.84, r: size * 0.038 },
    ];

    // ── Sample dots across all lobes ──────────────────────────────────────────
    const dots: Dot[] = [];

    // Family-standard density (matches Dahlia/Dandelion/Fern).
    const TOTAL_DOTS = Math.max(9000, Math.round((size * size) / 9));

    function insideAnyLobe(x: number, y: number, lobes: Lobe[]): boolean {
      return lobes.some((lobe) => (x - lobe.cx) ** 2 + (y - lobe.cy) ** 2 <= lobe.r ** 2);
    }

    function estimateUnionArea(lobes: Lobe[], minX: number, minY: number, maxX: number, maxY: number): number {
      const samples = 1600;
      let hits = 0;
      for (let i = 0; i < samples; i++) {
        const x = minX + Math.random() * (maxX - minX);
        const y = minY + Math.random() * (maxY - minY);
        if (insideAnyLobe(x, y, lobes)) hits += 1;
      }
      return ((maxX - minX) * (maxY - minY) * hits) / samples;
    }

    function boundsFor(lobes: Lobe[]) {
      return lobes.reduce(
        (bounds, lobe) => ({
          minX: Math.min(bounds.minX, lobe.cx - lobe.r),
          minY: Math.min(bounds.minY, lobe.cy - lobe.r),
          maxX: Math.max(bounds.maxX, lobe.cx + lobe.r),
          maxY: Math.max(bounds.maxY, lobe.cy + lobe.r),
        }),
        { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: 0, maxY: 0 },
      );
    }

    function seedUniformUnion(
      lobes: Lobe[],
      n: number,
      foldCx: number,
      foldCy: number,
      foldScale: number,
      breathOffset: number,
    ) {
      const { minX, minY, maxX, maxY } = boundsFor(lobes);
      for (let i = 0; i < n; i++) {
        let x = minX;
        let y = minY;
        // Rejection sampling across the union avoids extra density where lobes overlap.
        for (let attempt = 0; attempt < 120; attempt++) {
          x = minX + Math.random() * (maxX - minX);
          y = minY + Math.random() * (maxY - minY);
          if (insideAnyLobe(x, y, lobes)) break;
        }
        dots.push({
          x,
          y,
          homeX: x,
          homeY: y,
          foldX: foldCx + (x - foldCx) * foldScale,
          foldY: foldCy + (y - foldCy) * foldScale,
          breathOffset,
          z: Math.random() * 2 - 1,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    const cloudBounds = boundsFor(cloudLobes);
    const mediumTailBounds = boundsFor(mediumTailLobes);
    const smallTailBounds = boundsFor(smallTailLobes);
    const cloudArea = estimateUnionArea(
      cloudLobes,
      cloudBounds.minX,
      cloudBounds.minY,
      cloudBounds.maxX,
      cloudBounds.maxY,
    );
    const mediumTailArea = estimateUnionArea(
      mediumTailLobes,
      mediumTailBounds.minX,
      mediumTailBounds.minY,
      mediumTailBounds.maxX,
      mediumTailBounds.maxY,
    );
    const smallTailArea = estimateUnionArea(
      smallTailLobes,
      smallTailBounds.minX,
      smallTailBounds.minY,
      smallTailBounds.maxX,
      smallTailBounds.maxY,
    );
    const totalArea = cloudArea + mediumTailArea + smallTailArea;
    const cloudDotCount = Math.round(TOTAL_DOTS * cloudArea / totalArea);
    const mediumTailDotCount = Math.round(TOTAL_DOTS * mediumTailArea / totalArea);
    const smallTailDotCount = TOTAL_DOTS - cloudDotCount - mediumTailDotCount;

    // Shared inhale point between the main cloud and the two tail bubbles, so
    // all three parts contract toward one common "thought" centre.
    const sharedFoldCx = size * 0.53;
    const sharedFoldCy = size * 0.61;
    // Smallest/lower tail starts first, then medium tail, then cloud.
    seedUniformUnion(cloudLobes, cloudDotCount, sharedFoldCx, sharedFoldCy, 0.84, 0);
    seedUniformUnion(mediumTailLobes, mediumTailDotCount, sharedFoldCx, sharedFoldCy, 0.78, 0.24);
    seedUniformUnion(smallTailLobes, smallTailDotCount, sharedFoldCx, sharedFoldCy, 0.78, 0.48);

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

      // One coherent breath: home → fold → home, then repeat.
      // This preserves the good first inhale, then runs the same motion in reverse.
      const breathPhase = time * 1.15;

      for (const dot of dots) {
        const breath = (1 - Math.cos(breathPhase + dot.breathOffset)) * 0.5;
        const targetX = dot.homeX + (dot.foldX - dot.homeX) * breath;
        const targetY = dot.homeY + (dot.foldY - dot.homeY) * breath;
        dot.x += (targetX - dot.x) * 0.12;
        dot.y += (targetY - dot.y) * 0.12;

        dot.z = stepZ(dot.z, time, dot.phase, breath, 0.18, 0.012);
        const df = depthFactor(dot.z);
        const opacity = Math.max(0.025, 0.28 + 0.07 * df);
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
