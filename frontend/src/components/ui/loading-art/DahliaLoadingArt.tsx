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

// ── Dahlia geometry ───────────────────────────────────────────────────────────
// A dahlia head is a dense, radially-symmetrical flower with many petals
// arranged in concentric rings. Each ring is rotationally offset from the
// previous one so petals interleave rather than stack.
//
// Home  = fully-bloomed: petals extended radially outward to their full length.
// Fold  = closed bud: all petals pull back toward center (fold fraction < 0.2).
// The shift between those two states is the breathing — clear inhale/exhale.

interface DahliaRing {
  petalCount: number;
  petalLength: number;
  petalWidth: number;
  rotOffset: number; // radian offset from ring 0 to stagger petals
  ringIdx: number;
}

interface DahliaPetal {
  angle: number;
  length: number;
  width: number;
  ringIdx: number;
}

interface DahliaDot {
  x: number;
  y: number;
  z: number;
  phase: number;
  homeX: number;
  homeY: number;
  // Fold target: same radial direction, pulled close to center — the bud.
  foldX: number;
  foldY: number;
  convergencePhase: number;
  convergenceSpeed: number;
}

export function DahliaLoadingArt({
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

    // ── Ring definitions ──────────────────────────────────────────────────
    // 7 rings: innermost has 8 short narrow petals, outermost 26 long wide ones.
    // rotOffset uses a near-golden-angle increment so no two rings align.
    const ringCount = 7;
    const rings: DahliaRing[] = Array.from({ length: ringCount }, (_, r) => ({
      petalCount: 8 + r * 3,
      petalLength: size * (0.055 + r * 0.030),
      petalWidth:  size * (0.016 + r * 0.003),
      rotOffset:   r * 0.53,
      ringIdx:     r,
    }));

    // ── Petal list ────────────────────────────────────────────────────────
    const petals: DahliaPetal[] = [];
    for (const ring of rings) {
      for (let p = 0; p < ring.petalCount; p += 1) {
        petals.push({
          angle:   (p / ring.petalCount) * Math.PI * 2 + ring.rotOffset,
          length:  ring.petalLength,
          width:   ring.petalWidth,
          ringIdx: ring.ringIdx,
        });
      }
    }

    // ── Seed dots ─────────────────────────────────────────────────────────
    const pointCount = Math.max(9000, Math.round((size * size) / 9));
    const dots: DahliaDot[] = [];

    // 12 % of dots go in a tight central disc (the dahlia's floret centre).
    const discCount = Math.round(pointCount * 0.12);
    for (let i = 0; i < discCount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.6) * size * 0.042;
      const homeX = cx + Math.cos(theta) * r;
      const homeY = cy + Math.sin(theta) * r;

      dots.push({
        x: homeX,
        y: homeY,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX,
        homeY,
        foldX: cx + (homeX - cx) * 0.35, // disc barely closes
        foldY: cy + (homeY - cy) * 0.35,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.016 + Math.random() * 0.014,
      });
    }

    // Remaining dots distributed across petals (weighted toward outer rings so
    // the bloom has more visual mass at the edge, like a real dahlia).
    const petalDotCount = pointCount - discCount;
    for (let i = 0; i < petalDotCount; i += 1) {
      // Weight petal selection by ring index (outer rings get proportionally
      // more dots because they are longer and visually dominant).
      const petal = petals[Math.floor(
        Math.pow(Math.random(), 0.62) * petals.length,
      )];

      // u along petal (0 = base, 1 = tip). Bias toward mid-petal for density.
      const u = Math.pow(Math.random(), 0.75);

      // Width profile: widest at ~35 % from base, tapering at tip.
      const widthProfile = Math.pow(Math.sin(Math.PI * u * 0.85 + 0.1), 0.7);
      const localW = (Math.random() * 2 - 1) * petal.width * widthProfile;
      const localL = u * petal.length;

      // Rotate local coords into world space along the petal angle.
      const cosA = Math.cos(petal.angle);
      const sinA = Math.sin(petal.angle);
      const homeX = cx + cosA * localL - sinA * localW;
      const homeY = cy + sinA * localL + cosA * localW;

      // Fold fraction: outer ring petals close more aggressively (smaller f).
      // r=0 inner → f=0.22 (barely closes); r=6 outer → f=0.09 (snaps to bud).
      const f = 0.22 - (petal.ringIdx / (ringCount - 1)) * 0.13;
      const foldX = cx + (homeX - cx) * f;
      const foldY = cy + (homeY - cy) * f;

      dots.push({
        x: homeX,
        y: homeY,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX,
        homeY,
        foldX,
        foldY,
        convergencePhase: Math.random() * Math.PI * 2,
        // Outer ring petals cycle a little faster, inner slower — natural.
        convergenceSpeed: 0.013 + (petal.ringIdx / ringCount) * 0.010 + Math.random() * 0.010,
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
          // Inhale: petals draw inward toward the bud.
          const distToFold = Math.sqrt(
            (dot.x - dot.foldX) ** 2 + (dot.y - dot.foldY) ** 2,
          );
          const speed = 0.034 * cycle * Math.min(1, distToFold / (size * 0.030));
          dot.x += (dot.foldX - dot.x) * speed;
          dot.y += (dot.foldY - dot.y) * speed;
        } else {
          // Exhale: petals bloom back out to home.
          const speed = 0.028 * Math.abs(cycle);
          dot.x += (dot.homeX - dot.x) * speed;
          dot.y += (dot.homeY - dot.y) * speed;

          // Shimmer drift on the open phase.
          const dx = dot.x - dot.homeX;
          const dy = dot.y - dot.homeY;
          const angle = Math.atan2(dy, dx);
          const driftMix = computeDrift(angle, dot.z, time, dot.phase, 2, 2, 0.005, 0.0038);
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
