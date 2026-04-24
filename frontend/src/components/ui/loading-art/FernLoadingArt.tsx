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

// ── Barnsley Fern IFS ─────────────────────────────────────────────────────────
// Output space: x ∈ [-2.5, 2.5],  y ∈ [0, 10] (upward positive)
function ifsStep(x: number, y: number): [number, number] {
  const r = Math.random();
  if (r < 0.01) {
    return [0, 0.16 * y];
  } else if (r < 0.86) {
    return [0.85 * x + 0.04 * y, -0.04 * x + 0.85 * y + 1.6];
  } else if (r < 0.93) {
    return [0.2 * x - 0.26 * y, 0.23 * x + 0.22 * y + 1.6];
  } else {
    return [-0.15 * x + 0.28 * y, 0.26 * x + 0.24 * y + 0.44];
  }
}

interface FernDot {
  x: number;
  y: number;
  z: number;
  phase: number;
  homeX: number;  // full frond position on the IFS attractor
  homeY: number;
  foldX: number;  // compressed fold position — on the central stem spine
  foldY: number;
  convergencePhase: number;
  convergenceSpeed: number;
}

export function FernLoadingArt({
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
    const frameWidth = size;
    const frameHeight = size;
    const cx = frameWidth / 2;
    const cy = frameHeight / 2;

    setupCanvas(canvas, ctx, frameWidth, frameHeight, deviceScale);

    const fernScale = size * 0.078;
    const fernOriginY = cy + size * 0.40;

    function ifsToScreen(ix: number, iy: number): [number, number] {
      return [cx + ix * fernScale, fernOriginY - iy * fernScale];
    }

    // ── Seed pool ─────────────────────────────────────────────────────────
    const poolSize = 24000;
    const pool: Array<[number, number]> = [];
    let ix = 0;
    let iy = 0;
    for (let w = 0; w < 100; w += 1) [ix, iy] = ifsStep(ix, iy);
    for (let i = 0; i < poolSize; i += 1) {
      [ix, iy] = ifsStep(ix, iy);
      pool.push([ix, iy]);
    }

    // ── Dots ──────────────────────────────────────────────────────────────
    const pointCount = Math.max(9000, Math.round((size * size) / 9));
    const dots: FernDot[] = [];

    for (let i = 0; i < pointCount; i += 1) {
      const [hx, hy] = ifsToScreen(...pool[i % poolSize]);
      const scatter = size * 0.008;
      const sa = Math.random() * Math.PI * 2;

      // Fold target: project each dot horizontally onto the central spine.
      // Stem dots (near cx) barely move; far frond tips travel the most.
      // We preserve homeY so the fold is purely lateral — like a fern
      // closing its pinnae inward toward the rachis.
      const foldX = cx + (hx - cx) * 0.08;
      const foldY = hy + (fernOriginY - hy) * 0.08; // also tucks slightly downward

      dots.push({
        x: hx + Math.cos(sa) * scatter * Math.random(),
        y: hy + Math.sin(sa) * scatter * Math.random(),
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX: hx,
        homeY: hy,
        foldX,
        foldY,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.012 + Math.random() * 0.012,
      });
    }

    let time = 0;
    let animationFrameId: number | null = null;
    let lastFrameTime = 0;
    const frameInterval = 1000 / 12;

    function drawFrame() {
      applyFade(ctx, frameWidth, frameHeight, 0.15);
      ctx.fillStyle = anchorInk;

      for (const dot of dots) {
        const { cycle, isConverging, nextPhase } = stepConvergence(
          dot.convergencePhase,
          dot.convergenceSpeed,
        );
        dot.convergencePhase = nextPhase;

        if (isConverging) {
          // Inhale: pinnae fold toward the rachis (spine). Dots near the spine
          // barely move; outer frond tips travel the full distance to foldX/foldY.
          const distToFold = Math.sqrt(
            (dot.x - dot.foldX) ** 2 + (dot.y - dot.foldY) ** 2,
          );
          const moveSpeed = 0.032 * cycle * Math.min(1, distToFold / (size * 0.035));
          dot.x += (dot.foldX - dot.x) * moveSpeed;
          dot.y += (dot.foldY - dot.y) * moveSpeed;
        } else {
          // Exhale: fronds spring back out to their full botanical home.
          const moveSpeed = 0.026 * Math.abs(cycle);
          dot.x += (dot.homeX - dot.x) * moveSpeed;
          dot.y += (dot.homeY - dot.y) * moveSpeed;

          // Shimmer drift layered on the release phase.
          const dx = dot.x - cx;
          const dy = dot.y - cy;
          const angle = Math.atan2(dy, dx);
          const driftMix = computeDrift(angle, dot.z, time, dot.phase, 2, 2, 0.006, 0.004);
          dot.x += dx * driftMix;
          dot.y += dy * driftMix;
        }

        dot.z = stepZ(dot.z, time, dot.phase, Math.abs(cycle), 0.18, 0.012);

        const df = depthFactor(dot.z);
        const opacity = Math.max(0.025, 0.32 * Math.abs(cycle) + 0.05 * df);
        drawDot(ctx, dot.x, dot.y, dotRadius(size, df, 950, 0.3), opacity);
      }

      ctx.globalAlpha = 1;
    }

    function animate(currentTime: number) {
      if (!lastFrameTime) lastFrameTime = currentTime;
      const delta = currentTime - lastFrameTime;
      if (delta >= frameInterval) {
        time += 0.055;
        drawFrame();
        lastFrameTime = currentTime - (delta % frameInterval);
      }
      animationFrameId = window.requestAnimationFrame(animate);
    }

    drawFrame();
    animationFrameId = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
      ctx.clearRect(0, 0, frameWidth, frameHeight);
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
