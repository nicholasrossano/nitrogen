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

interface WisteriaDot {
  x: number;
  y: number;
  z: number;
  phase: number;
  homeX: number;
  homeY: number;
  // Fold = compressed toward the central stem — the raceme "closes" inward.
  foldX: number;
  foldY: number;
  tNorm: number;     // 0 = top of raceme, 1 = drooping tip
  part: 'stem' | 'flower';
  swayAmplitude: number;
  swayPhase: number;
  convergencePhase: number;
  convergenceSpeed: number;
}

export function WisteriaLoadingArt({
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

    // ── Wisteria raceme geometry ───────────────────────────────────────────
    // A real wisteria raceme is a cone: widest at the top where it hangs from
    // the vine, tapering to a pointed tip at the bottom.
    // Width profile: maxHalfWidth × (1 – tNorm)^0.62  — starts wide, narrows.
    //
    // Home  = full triangular spread (bloomed raceme).
    // Fold  = each dot pulls laterally toward the stem axis (compressed to a
    //         thin line) — like the raceme closing into a bud. Bottom dots
    //         sway more so the tip of the triangle flutters visibly.

    const attachY     = cy - size * 0.30;   // top of raceme (vine attachment)
    const stemLength  = size * 0.64;        // vertical drop to pointed tip
    const maxHalfWidth = size * 0.185;      // half-width at the very top

    // Slight S-curve on the stem so it doesn't look mechanical.
    function stemXAt(t: number): number {
      return cx + Math.sin(t * 2.1 + 0.4) * size * 0.022 * t;
    }

    // Width of the raceme envelope at position t.
    function halfWidthAt(t: number): number {
      return maxHalfWidth * Math.pow(1 - t, 0.62);
    }

    const pointCount = Math.max(9000, Math.round((size * size) / 9));
    const stemCount  = Math.round(pointCount * 0.10);
    const flowerCount = pointCount - stemCount;
    const dots: WisteriaDot[] = [];

    // ── Stem dots ─────────────────────────────────────────────────────────
    for (let i = 0; i < stemCount; i += 1) {
      const tNorm = Math.pow(Math.random(), 0.8);
      const homeX = stemXAt(tNorm) + (Math.random() * 2 - 1) * size * 0.005;
      const homeY = attachY + tNorm * stemLength + (Math.random() - 0.5) * size * 0.007;

      dots.push({
        x: homeX, y: homeY,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX, homeY,
        foldX: stemXAt(tNorm),  // stem barely moves
        foldY: homeY,
        tNorm,
        part: 'stem',
        swayAmplitude: size * (0.003 + tNorm * 0.008),
        swayPhase: Math.random() * Math.PI * 2,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.013 + Math.random() * 0.010,
      });
    }

    // ── Flower dots ───────────────────────────────────────────────────────
    for (let i = 0; i < flowerCount; i += 1) {
      // Bias toward top: wisteria is denser near the vine attachment.
      const tNorm = Math.pow(Math.random(), 0.70);
      const stemX = stemXAt(tNorm);
      const stemY = attachY + tNorm * stemLength;

      const hw = halfWidthAt(tNorm);
      // Lateral offset: uniform across the envelope width (triangular silhouette).
      const lateral = (Math.random() * 2 - 1) * hw;
      const homeX = stemX + lateral;
      const homeY = stemY + (Math.random() - 0.5) * size * (0.012 + tNorm * 0.008);

      // Fold: compress laterally toward the stem axis.
      // Near the tip (high tNorm) the width is already tiny so we keep more;
      // near the top (low tNorm) dots travel the full width inward.
      const foldFraction = 0.08 + tNorm * 0.10; // 0.08 at top → 0.18 at tip
      const foldX = stemX + lateral * foldFraction;
      const foldY = homeY + (stemY - homeY) * 0.05; // barely any vertical travel

      dots.push({
        x: homeX, y: homeY,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX, homeY,
        foldX, foldY,
        tNorm,
        part: 'flower',
        // Sway increases toward tip (longer pendulum effect).
        swayAmplitude: size * (0.006 + tNorm * 0.022),
        swayPhase: Math.random() * Math.PI * 2,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.013 + Math.random() * 0.013,
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

        // Wind sway: increases toward the tip, where the raceme is most flexible.
        const swayX = Math.sin(time * 0.70 + dot.swayPhase) * dot.swayAmplitude;
        const swayY = Math.cos(time * 0.42 + dot.swayPhase) * size * 0.003 * dot.tNorm;

        if (isConverging) {
          // Inhale: raceme cinches toward its stem — the triangular bunch narrows.
          const distToFold = Math.sqrt(
            (dot.x - dot.foldX) ** 2 + (dot.y - dot.foldY) ** 2,
          );
          const speed = dot.part === 'flower'
            ? 0.032 * cycle * Math.min(1, distToFold / (size * 0.028))
            : 0.018 * cycle;
          dot.x += (dot.foldX - dot.x) * speed;
          dot.y += (dot.foldY - dot.y) * speed;
        } else {
          // Exhale: dots bloom back to their triangular home positions + sway.
          const targetX = dot.homeX + swayX;
          const targetY = dot.homeY + swayY;
          const speed = dot.part === 'flower'
            ? 0.028 * Math.abs(cycle)
            : 0.016 * Math.abs(cycle);
          dot.x += (targetX - dot.x) * speed;
          dot.y += (targetY - dot.y) * speed;

          // Shimmer drift anchored to the bunch's vertical midpoint.
          const driftCY = attachY + stemLength * 0.40;
          const dx = dot.x - cx;
          const dy = dot.y - driftCY;
          const angle = Math.atan2(dy, dx);
          const driftMix = computeDrift(angle, dot.z, time, dot.phase, 2, 2, 0.0048, 0.0036);
          dot.x += dx * driftMix;
          dot.y += dy * driftMix;

          // Soft home pull so dots don't drift outside the envelope.
          dot.x += (targetX - dot.x) * 0.008;
          dot.y += (targetY - dot.y) * 0.008;
        }

        dot.z = stepZ(dot.z, time, dot.phase, dot.tNorm + Math.abs(cycle), 0.18, 0.012);

        const df = depthFactor(dot.z);
        const opacityBase = dot.part === 'flower' ? 0.31 : 0.16;
        const opacity = Math.max(0.025, opacityBase * Math.abs(cycle) + 0.05 * df);
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
