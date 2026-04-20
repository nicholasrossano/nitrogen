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

const DEFAULT_SIZE = 320;

type DandelionPart = 'core' | 'halo' | 'flight';

interface BloomPoint {
  x: number;
  y: number;
  z: number;
  phase: number;
  homeX: number;
  homeY: number;
  part: DandelionPart;
  windStrength: number;
  convergencePhase: number;
  convergenceSpeed: number;
}

export function DandelionLoadingArt({
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
    const coreX = frameWidth / 2 - size * 0.045;
    const coreY = frameHeight / 2;
    const bloomRadius = size * 0.23;
    const pointCount = Math.max(9000, Math.round((size * size) / 9));

    setupCanvas(canvas, ctx, frameWidth, frameHeight, deviceScale);

    const bloomPoints: BloomPoint[] = [];
    const coreCount = Math.round(pointCount * 0.14);
    const haloCount = Math.round(pointCount * 0.68);
    const flightCount = pointCount - coreCount - haloCount;

    for (let i = 0; i < coreCount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 0.85) * bloomRadius * 0.18;

      bloomPoints.push({
        x: coreX + Math.cos(theta) * radius,
        y: coreY + Math.sin(theta) * radius,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX: coreX + Math.cos(theta) * radius,
        homeY: coreY + Math.sin(theta) * radius,
        part: 'core',
        windStrength: size * 0.002,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.015 + Math.random() * 0.01,
      });
    }

    for (let i = 0; i < haloCount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const radius = bloomRadius * (0.5 + Math.pow(Math.random(), 0.45) * 0.5);
      const shellBias = 1 + Math.sin(theta - 0.35) * 0.06;

      bloomPoints.push({
        x: coreX + Math.cos(theta) * radius * shellBias,
        y: coreY + Math.sin(theta) * radius,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX: coreX + Math.cos(theta) * radius * shellBias,
        homeY: coreY + Math.sin(theta) * radius,
        part: 'halo',
        windStrength: size * (0.004 + Math.random() * 0.004),
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.014 + Math.random() * 0.012,
      });
    }

    for (let i = 0; i < flightCount; i += 1) {
      const u = Math.pow(Math.random(), 0.72);
      const driftY = (Math.random() * 2 - 1) * size * 0.09 * (1 - u * 0.4);
      const x = coreX + bloomRadius * 0.42 + u * size * 0.29;
      const y =
        coreY -
        u * size * 0.13 +
        Math.sin(u * Math.PI * 4 + Math.random() * Math.PI * 2) * size * 0.018 +
        driftY;

      bloomPoints.push({
        x,
        y,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX: x,
        homeY: y,
        part: 'flight',
        windStrength: size * (0.009 + u * 0.01),
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

      for (const bloomPoint of bloomPoints) {
        const { cycle, isConverging, nextPhase } = stepConvergence(
          bloomPoint.convergencePhase,
          bloomPoint.convergenceSpeed,
        );
        bloomPoint.convergencePhase = nextPhase;

        if (isConverging) {
          const moveSpeed =
            bloomPoint.part === 'core'
              ? 0.018 * cycle
              : bloomPoint.part === 'halo'
                ? 0.024 * cycle
                : 0.028 * cycle;
          bloomPoint.x += (bloomPoint.homeX - bloomPoint.x) * moveSpeed;
          bloomPoint.y += (bloomPoint.homeY - bloomPoint.y) * moveSpeed;
        } else {
          const dx = bloomPoint.x - coreX;
          const dy = bloomPoint.y - coreY;
          const angle = Math.atan2(dy, dx);
          const driftMix = computeDrift(angle, bloomPoint.z, time, bloomPoint.phase, 2, 2, 0.006, 0.004);

          bloomPoint.x += dx * driftMix + bloomPoint.windStrength * Math.abs(cycle);
          bloomPoint.y += dy * driftMix - bloomPoint.windStrength * 0.24 * Math.abs(cycle);

          const homePull = bloomPoint.part === 'flight' ? 0.005 : 0.008;
          bloomPoint.x += (bloomPoint.homeX - bloomPoint.x) * homePull;
          bloomPoint.y += (bloomPoint.homeY - bloomPoint.y) * homePull;
        }

        bloomPoint.z = stepZ(
          bloomPoint.z,
          time,
          bloomPoint.phase,
          Math.abs(cycle) + (bloomPoint.part === 'flight' ? 0.5 : 0),
          0.18,
          0.012,
        );

        const df = depthFactor(bloomPoint.z);
        const opacityBase =
          bloomPoint.part === 'core' ? 0.16 : bloomPoint.part === 'halo' ? 0.3 : 0.24;
        const opacity = Math.max(0.02, opacityBase * Math.abs(cycle) + 0.05 * df);
        drawDot(ctx, bloomPoint.x, bloomPoint.y, dotRadius(size, df, 960, 0.3), opacity);
      }

      ctx.globalAlpha = 1;
    }

    function animate(currentTime: number) {
      if (!lastFrameTime) lastFrameTime = currentTime;

      const deltaTime = currentTime - lastFrameTime;
      if (deltaTime >= frameInterval) {
        time += 0.055;
        drawFrame();
        lastFrameTime = currentTime - (deltaTime % frameInterval);
      }

      animationFrameId = window.requestAnimationFrame(animate);
    }

    drawFrame();
    animationFrameId = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
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
