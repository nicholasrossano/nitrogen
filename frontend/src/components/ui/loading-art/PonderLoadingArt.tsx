'use client';

import { useEffect, useRef } from 'react';

import type { LoadingArtProps } from './types';
import { depthFactor, dotRadius, drawDot, setupCanvas, stepZ } from './physics';
import { resolveCssColorValue } from './utils';

const DEFAULT_SIZE = 280;

// ── Cloud bump profile ────────────────────────────────────────────────────────
// Returns a radial scale factor > 1 at peaks and < 1 at troughs.
// 9 primary bumps + two weaker harmonics so the bumps are uneven / natural.
function cloudBump(θ: number): number {
  return (
    1 +
    0.13 * Math.sin(9 * θ + 0.4) +
    0.04 * Math.sin(6 * θ + 1.0) +
    0.03 * Math.cos(12 * θ)
  );
}

interface PonderDot {
  readonly x: number;
  readonly y: number;
  z: number;
  readonly phase: number;
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

    // ── Shape parameters ──────────────────────────────────────────────────────
    // Classic thought bubble: large bumpy cloud (upper-left) + two shrinking
    // ovals as the "tail" toward the implied thinker (lower-right).
    const cCx = size * 0.38;   // cloud centre x
    const cCy = size * 0.37;   // cloud centre y
    const cRx = size * 0.30;   // cloud half-width (slightly wider than tall)
    const cRy = size * 0.26;   // cloud half-height

    const o1Cx = size * 0.73;  // oval 1 centre
    const o1Cy = size * 0.72;
    const o1Rx = size * 0.088; // oval 1 half-width
    const o1Ry = size * 0.062; // oval 1 half-height

    const o2Cx = size * 0.84;  // oval 2 centre (smallest)
    const o2Cy = size * 0.84;
    const o2Rx = size * 0.052;
    const o2Ry = size * 0.038;

    // ── Dot seeding helpers ───────────────────────────────────────────────────
    // For the cloud: 82 % of dots placed near the bumpy outline so the shape
    // reads as a cloud silhouette, not a solid disc.  Outline dots scatter
    // ±14 % radially from the bump surface.  Interior dots are uniformly sparse.
    function seedCloud(n: number): PonderDot[] {
      const out: PonderDot[] = [];
      const nOutline = Math.round(n * 0.82);
      for (let i = 0; i < n; i++) {
        const θ = Math.random() * Math.PI * 2;
        const bump = cloudBump(θ);
        let scaleFrac: number;
        if (i < nOutline) {
          // outline band: 86 % – 114 % of bump radius
          scaleFrac = bump * (0.86 + Math.random() * 0.28);
        } else {
          // interior: uniform up to 85 % of bump radius
          scaleFrac = bump * Math.random() * 0.85;
        }
        out.push({
          x: cCx + cRx * scaleFrac * Math.cos(θ),
          y: cCy + cRy * scaleFrac * Math.sin(θ),
          z: Math.random() * 2 - 1,
          phase: Math.random() * Math.PI * 2,
        });
      }
      return out;
    }

    // For the ovals: 80 % outline, 20 % interior.
    function seedOval(
      n: number,
      cx: number, cy: number,
      rx: number, ry: number,
    ): PonderDot[] {
      const out: PonderDot[] = [];
      const nOutline = Math.round(n * 0.80);
      for (let i = 0; i < n; i++) {
        const θ = Math.random() * Math.PI * 2;
        let rFrac: number;
        if (i < nOutline) {
          rFrac = 0.84 + Math.random() * 0.32; // 84–116 %
        } else {
          rFrac = Math.sqrt(Math.random()) * 0.82;
        }
        out.push({
          x: cx + rx * rFrac * Math.cos(θ),
          y: cy + ry * rFrac * Math.sin(θ),
          z: Math.random() * 2 - 1,
          phase: Math.random() * Math.PI * 2,
        });
      }
      return out;
    }

    // Dot counts keep per-shape density proportional to their outline length.
    const cloudDots = seedCloud(4200);
    const oval1Dots = seedOval(620, o1Cx, o1Cy, o1Rx, o1Ry);
    const oval2Dots = seedOval(260, o2Cx, o2Cy, o2Rx, o2Ry);
    const allDots: PonderDot[] = [...cloudDots, ...oval1Dots, ...oval2Dots];

    let time = 0;
    let animFrameId: number | null = null;
    let lastFrameTime = 0;
    const frameInterval = 1000 / 30;

    function drawFrame() {
      // clearRect keeps every dot crisp — no destination-out accumulation.
      context.clearRect(0, 0, fw, fh);
      context.fillStyle = anchorInk;

      for (const dot of allDots) {
        // Only z breathes — positions are fixed at seed time.
        dot.z = stepZ(dot.z, time, dot.phase, 0, 0.20, 0.016);
        const df      = depthFactor(dot.z);
        const opacity = Math.max(0.04, 0.40 * df);
        const radius  = dotRadius(size, df, 700, 0.30);
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
