'use client';

import { useEffect, useRef } from 'react';

import type { LoadingArtProps } from './types';
import {
  applyFade,
  computeDrift,
  containmentPull,
  depthFactor,
  dotRadius,
  drawDot,
  setupCanvas,
  stepConvergence,
  stepZ,
} from './physics';
import { resolveCssColorValue } from './utils';

const DEFAULT_SIZE = 360;

interface NeedleDot {
  x: number;
  y: number;
  homeAngle: number;
  homeRadius: number;
  phase: number;
  z: number;
  needleBias: number;
  // Iris DNA: each dot breathes on its own cycle so they're never in sync.
  convergencePhase: number;
  convergenceSpeed: number;
}

export function PineLoadingArt({
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

    const maxR = frameWidth * 0.42;

    const tuftCount = 48;
    const dotsPerTuft = 180;
    const tuftAngles: number[] = [];
    for (let i = 0; i < tuftCount; i += 1) {
      tuftAngles.push((i / tuftCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.09);
    }

    const dots: NeedleDot[] = [];
    for (let t = 0; t < tuftCount; t += 1) {
      const baseAngle = tuftAngles[t];
      for (let d = 0; d < dotsPerTuft; d += 1) {
        const rNorm = 0.07 + Math.pow(Math.random(), 0.85) * 0.9;
        const r = rNorm * maxR;
        const angJitter = (Math.random() - 0.5) * (0.22 - rNorm * 0.16);
        const homeAngle = baseAngle + angJitter;
        const initOffset = (Math.random() - 0.5) * (maxR * 0.012);
        dots.push({
          x: cx + Math.cos(homeAngle) * (r + initOffset),
          y: cy + Math.sin(homeAngle) * (r + initOffset),
          homeAngle,
          homeRadius: r,
          phase: Math.random() * Math.PI * 2,
          z: Math.random() * 2 - 1,
          needleBias: 0.55 + Math.random() * 0.45,
          // Random initial phase = desync across all dots from frame 1.
          convergencePhase: Math.random() * Math.PI * 2,
          // Speed range → each dot's cycle period ~20-42 seconds at 12fps.
          convergenceSpeed: 0.015 + Math.random() * 0.013,
        });
      }
    }

    let time = 0;
    let animationFrameId: number | null = null;
    let lastFrameTime = 0;
    const frameInterval = 1000 / 12;

    function drawFrame() {
      applyFade(ctx, frameWidth, frameHeight, 0.15);
      ctx.fillStyle = anchorInk;

      for (const dot of dots) {
        // ── Iris convergence/release ────────────────────────────────────────
        const { cycle, isConverging, nextPhase } = stepConvergence(
          dot.convergencePhase,
          dot.convergenceSpeed,
        );
        dot.convergencePhase = nextPhase;

        const dx = dot.x - cx;
        const dy = dot.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        if (isConverging) {
          // Pull toward center, speed proportional to distance (iris formula).
          const moveSpeed = 0.02 * cycle * (dist / maxR);
          dot.x += (cx - dot.x) * moveSpeed;
          dot.y += (cy - dot.y) * moveSpeed;
        } else {
          // Release: spring back to needle home (pine's adaptation of iris's
          // "opposite orbit" — we return to the needle home instead so the
          // tuft structure survives).
          const homeX = cx + Math.cos(dot.homeAngle) * dot.homeRadius;
          const homeY = cy + Math.sin(dot.homeAngle) * dot.homeRadius;
          const moveSpeed = 0.03 * Math.abs(cycle) * dot.needleBias;
          dot.x += (homeX - dot.x) * moveSpeed;
          dot.y += (homeY - dot.y) * moveSpeed;
        }

        // Small dandelion drift on top — adds shimmer along needle streaks
        // without competing with the convergence motion.
        const driftMix = computeDrift(angle, dot.z, time, dot.phase, 3, 2, 0.006, 0.004);
        dot.x += dx * driftMix;
        dot.y += dy * driftMix;

        // Edge containment — ^6 power so it's invisible until the very boundary.
        const radiusRatio = dist / maxR;
        const pull = containmentPull(radiusRatio, 1.0, 6) * 0.11;
        dot.x -= dx * pull;
        dot.y -= dy * pull;

        dot.z = stepZ(dot.z, time, dot.phase, radiusRatio * 1.5, 0.2, 0.014);

        // Opacity: tied to |cycle| (iris formula) + a floor from depth.
        // Dots near the phase crossing fade out, brightest at peak convergence/expansion.
        const df = depthFactor(dot.z, 0.45);
        const cycleOpacity = 0.28 * Math.abs(cycle);
        const opacity = Math.max(0.04, cycleOpacity + 0.07 * df);
        const edgeFade = radiusRatio < 0.85
          ? 1
          : Math.max(0, 1 - Math.pow((radiusRatio - 0.85) / 0.15, 2));
        drawDot(ctx, dot.x, dot.y, dotRadius(size, df, 900, 0.3), opacity * edgeFade);
      }

      // Central glow pulses on a slow independent cycle (iris signature).
      const centralGlow = Math.sin(time * 0.22) * 0.5 + 0.5;
      ctx.globalAlpha = 0.09 + centralGlow * 0.16;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.6 + centralGlow * 2.4, 0, Math.PI * 2);
      ctx.fill();

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
