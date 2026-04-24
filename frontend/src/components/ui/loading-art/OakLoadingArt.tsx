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

interface BranchDef {
  startX: number;
  startY: number;
  controlX: number;
  controlY: number;
  endX: number;
  endY: number;
  thicknessStart: number;
  thicknessEnd: number;
}

interface LobeDef {
  centerX: number;
  centerY: number;
  radius: number;
  weight: number;
}

interface OakDot {
  x: number;
  y: number;
  z: number;
  phase: number;
  homeX: number;
  homeY: number;
  foldX: number;
  foldY: number;
  part: 'leaf' | 'wood';
  canopyBias: number;
  swayAmplitude: number;
  swayPhase: number;
  convergencePhase: number;
  convergenceSpeed: number;
}

function pointOnQuadraticBranch(branch: BranchDef, t: number): { x: number; y: number } {
  const oneMinusT = 1 - t;

  return {
    x:
      oneMinusT * oneMinusT * branch.startX
      + 2 * oneMinusT * t * branch.controlX
      + t * t * branch.endX,
    y:
      oneMinusT * oneMinusT * branch.startY
      + 2 * oneMinusT * t * branch.controlY
      + t * t * branch.endY,
  };
}

function tangentOnQuadraticBranch(branch: BranchDef, t: number): { x: number; y: number } {
  return {
    x:
      2 * (1 - t) * (branch.controlX - branch.startX)
      + 2 * t * (branch.endX - branch.controlX),
    y:
      2 * (1 - t) * (branch.controlY - branch.startY)
      + 2 * t * (branch.endY - branch.controlY),
  };
}

export function OakLoadingArt({
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

    const trunkBaseY = cy + size * 0.34;
    const trunkTopY = cy + size * 0.08;
    const canopyCenterX = cx;
    const canopyCenterY = cy - size * 0.06;
    const trunkHeight = trunkBaseY - trunkTopY;

    const branches: BranchDef[] = [
      {
        startX: cx,
        startY: trunkTopY + size * 0.02,
        controlX: cx - size * 0.07,
        controlY: cy - size * 0.03,
        endX: cx - size * 0.20,
        endY: cy - size * 0.13,
        thicknessStart: size * 0.026,
        thicknessEnd: size * 0.005,
      },
      {
        startX: cx,
        startY: trunkTopY + size * 0.01,
        controlX: cx - size * 0.03,
        controlY: cy - size * 0.11,
        endX: cx - size * 0.11,
        endY: cy - size * 0.24,
        thicknessStart: size * 0.023,
        thicknessEnd: size * 0.004,
      },
      {
        startX: cx,
        startY: trunkTopY,
        controlX: cx,
        controlY: cy - size * 0.12,
        endX: cx,
        endY: cy - size * 0.28,
        thicknessStart: size * 0.022,
        thicknessEnd: size * 0.004,
      },
      {
        startX: cx,
        startY: trunkTopY + size * 0.01,
        controlX: cx + size * 0.03,
        controlY: cy - size * 0.11,
        endX: cx + size * 0.11,
        endY: cy - size * 0.24,
        thicknessStart: size * 0.023,
        thicknessEnd: size * 0.004,
      },
      {
        startX: cx,
        startY: trunkTopY + size * 0.02,
        controlX: cx + size * 0.07,
        controlY: cy - size * 0.03,
        endX: cx + size * 0.20,
        endY: cy - size * 0.13,
        thicknessStart: size * 0.026,
        thicknessEnd: size * 0.005,
      },
    ];

    const branchlets: BranchDef[] = [
      {
        startX: cx - size * 0.12,
        startY: cy - size * 0.10,
        controlX: cx - size * 0.16,
        controlY: cy - size * 0.16,
        endX: cx - size * 0.23,
        endY: cy - size * 0.18,
        thicknessStart: size * 0.012,
        thicknessEnd: size * 0.003,
      },
      {
        startX: cx - size * 0.05,
        startY: cy - size * 0.16,
        controlX: cx - size * 0.08,
        controlY: cy - size * 0.23,
        endX: cx - size * 0.14,
        endY: cy - size * 0.29,
        thicknessStart: size * 0.011,
        thicknessEnd: size * 0.0025,
      },
      {
        startX: cx,
        startY: cy - size * 0.16,
        controlX: cx - size * 0.02,
        controlY: cy - size * 0.24,
        endX: cx - size * 0.05,
        endY: cy - size * 0.31,
        thicknessStart: size * 0.01,
        thicknessEnd: size * 0.0025,
      },
      {
        startX: cx,
        startY: cy - size * 0.16,
        controlX: cx + size * 0.02,
        controlY: cy - size * 0.24,
        endX: cx + size * 0.05,
        endY: cy - size * 0.31,
        thicknessStart: size * 0.01,
        thicknessEnd: size * 0.0025,
      },
      {
        startX: cx + size * 0.05,
        startY: cy - size * 0.16,
        controlX: cx + size * 0.08,
        controlY: cy - size * 0.23,
        endX: cx + size * 0.14,
        endY: cy - size * 0.29,
        thicknessStart: size * 0.011,
        thicknessEnd: size * 0.0025,
      },
      {
        startX: cx + size * 0.12,
        startY: cy - size * 0.10,
        controlX: cx + size * 0.16,
        controlY: cy - size * 0.16,
        endX: cx + size * 0.23,
        endY: cy - size * 0.18,
        thicknessStart: size * 0.012,
        thicknessEnd: size * 0.003,
      },
    ];
    const allBranches = [...branches, ...branchlets];

    const canopyLobes: LobeDef[] = [
      { centerX: cx, centerY: cy - size * 0.22, radius: size * 0.13, weight: 1.2 },
      { centerX: cx - size * 0.11, centerY: cy - size * 0.20, radius: size * 0.11, weight: 0.95 },
      { centerX: cx + size * 0.11, centerY: cy - size * 0.20, radius: size * 0.11, weight: 0.95 },
      { centerX: cx - size * 0.045, centerY: cy - size * 0.11, radius: size * 0.105, weight: 1.0 },
      { centerX: cx + size * 0.045, centerY: cy - size * 0.11, radius: size * 0.105, weight: 1.0 },
      { centerX: cx - size * 0.19, centerY: cy - size * 0.12, radius: size * 0.115, weight: 1.0 },
      { centerX: cx + size * 0.19, centerY: cy - size * 0.12, radius: size * 0.115, weight: 1.0 },
      { centerX: cx - size * 0.23, centerY: cy - size * 0.01, radius: size * 0.09, weight: 0.8 },
      { centerX: cx + size * 0.23, centerY: cy - size * 0.01, radius: size * 0.09, weight: 0.8 },
      { centerX: cx, centerY: cy - size * 0.02, radius: size * 0.11, weight: 0.95 },
      { centerX: cx - size * 0.14, centerY: cy + size * 0.05, radius: size * 0.115, weight: 1.0 },
      { centerX: cx + size * 0.14, centerY: cy + size * 0.05, radius: size * 0.115, weight: 1.0 },
      { centerX: cx - size * 0.01, centerY: cy + size * 0.08, radius: size * 0.11, weight: 1.05 },
      { centerX: cx + size * 0.01, centerY: cy + size * 0.08, radius: size * 0.11, weight: 1.05 },
    ];

    const branchTips = allBranches.map((branch) => ({
      x: branch.endX,
      y: branch.endY,
      radius: size * 0.075,
    }));

    function sampleScaffoldPoint(x: number, y: number): { x: number; y: number } {
      let nearestX = cx;
      let nearestY = y;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i <= 18; i += 1) {
        const t = i / 18;
        const trunkY = trunkBaseY - t * trunkHeight;
        const dx = x - cx;
        const dy = y - trunkY;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          nearestX = cx;
          nearestY = trunkY;
        }
      }

      for (const branch of allBranches) {
        for (let i = 0; i <= 24; i += 1) {
          const t = i / 24;
          const point = pointOnQuadraticBranch(branch, t);
          const dx = x - point.x;
          const dy = y - point.y;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            bestDistance = distance;
            nearestX = point.x;
            nearestY = point.y;
          }
        }
      }

      return { x: nearestX, y: nearestY };
    }

    function canopyFieldAt(x: number, y: number): number {
      let field = 0;

      for (const lobe of canopyLobes) {
        const distance = Math.hypot(x - lobe.centerX, y - lobe.centerY);
        const normalized = Math.max(0, 1 - distance / lobe.radius);
        field += Math.pow(normalized, 1.65) * lobe.weight;
      }

      for (const tip of branchTips) {
        const distance = Math.hypot(x - tip.x, y - tip.y);
        const normalized = Math.max(0, 1 - distance / tip.radius);
        field += Math.pow(normalized, 1.85) * 0.28;
      }

      const innerCoreDx = (x - canopyCenterX) / (size * 0.17);
      const innerCoreDy = (y - (canopyCenterY + size * 0.035)) / (size * 0.14);
      const innerCore = Math.max(0, 1 - innerCoreDx * innerCoreDx - innerCoreDy * innerCoreDy);
      field += Math.pow(innerCore, 1.4) * 0.82;

      const crownDistance = Math.hypot(x - canopyCenterX, y - canopyCenterY);
      const edgeLimit = size * 0.31;
      const edgeFade = 1 - Math.min(1, Math.max(0, crownDistance - size * 0.26) / (edgeLimit - size * 0.26));
      const edgeFactor = 0.72 + edgeFade * 0.28;

      const angle = Math.atan2(y - canopyCenterY, x - canopyCenterX);
      const ripple = 0.92 + Math.sin(angle * 5 + crownDistance / (size * 0.075)) * 0.08;

      return field * edgeFactor * ripple;
    }

    function sampleLeafHome(): { homeX: number; homeY: number; foldX: number; foldY: number; canopyBias: number } {
      while (true) {
        const homeX = cx + (Math.random() * 2 - 1) * size * 0.295;
        const homeY = canopyCenterY + (Math.random() * 2 - 1) * size * 0.255;

        const crownDistance = Math.hypot(homeX - canopyCenterX, homeY - canopyCenterY);
        if (crownDistance > size * 0.31) continue;
        if (homeY > cy + size * 0.18) continue;

        const canopyField = canopyFieldAt(homeX, homeY);
        if (canopyField < 0.28) continue;
        if (Math.random() > Math.min(1, 0.42 + canopyField * 0.36)) continue;

        const trunkNotch = homeY > cy + size * 0.085 && Math.abs(homeX - cx) < size * 0.05;
        if (trunkNotch && Math.random() < 0.42) continue;

        const scaffold = sampleScaffoldPoint(homeX, homeY);
        const branchPull = 0.12 + Math.random() * 0.08;

        return {
          homeX,
          homeY,
          foldX: scaffold.x + (homeX - scaffold.x) * branchPull,
          foldY: scaffold.y + (homeY - scaffold.y) * branchPull,
          canopyBias: Math.min(1, 0.35 * canopyField + crownDistance / (size * 0.34)),
        };
      }
    }

    const pointCount = Math.max(11200, Math.round((size * size) / 7.7));
    const woodCount = Math.round(pointCount * 0.2);
    const trunkCount = Math.round(woodCount * 0.44);
    const branchCount = woodCount - trunkCount;
    const leafCount = pointCount - woodCount;
    const dots: OakDot[] = [];

    for (let i = 0; i < trunkCount; i += 1) {
      const t = Math.pow(Math.random(), 0.82);
      const centerY = trunkBaseY - t * trunkHeight;
      const trunkHalfWidth = size * (0.022 + (1 - t) * 0.03);
      const lateral = (Math.random() * 2 - 1) * trunkHalfWidth;
      const verticalJitter = (Math.random() - 0.5) * size * 0.006;
      const homeX = cx + lateral;
      const homeY = centerY + verticalJitter;

      dots.push({
        x: homeX,
        y: homeY,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX,
        homeY,
        foldX: cx + lateral * 0.2,
        foldY: centerY,
        part: 'wood',
        canopyBias: t * 0.25,
        swayAmplitude: size * 0.0015,
        swayPhase: Math.random() * Math.PI * 2,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.011 + Math.random() * 0.008,
      });
    }

    for (let i = 0; i < branchCount; i += 1) {
      const branch = allBranches[Math.floor(Math.random() * allBranches.length)];
      const t = Math.pow(Math.random(), 0.8);
      const point = pointOnQuadraticBranch(branch, t);
      const tangent = tangentOnQuadraticBranch(branch, t);
      const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
      const normalX = -tangent.y / tangentLength;
      const normalY = tangent.x / tangentLength;
      const thickness =
        branch.thicknessStart + (branch.thicknessEnd - branch.thicknessStart) * t;
      const lateral = (Math.random() * 2 - 1) * thickness;
      const homeX = point.x + normalX * lateral;
      const homeY = point.y + normalY * lateral;

      dots.push({
        x: homeX,
        y: homeY,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX,
        homeY,
        foldX: point.x + normalX * lateral * 0.18,
        foldY: point.y + normalY * lateral * 0.18,
        part: 'wood',
        canopyBias: 0.35 + t * 0.35,
        swayAmplitude: size * (0.001 + t * 0.0025),
        swayPhase: Math.random() * Math.PI * 2,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.012 + Math.random() * 0.008,
      });
    }

    for (let i = 0; i < leafCount; i += 1) {
      const leaf = sampleLeafHome();
      const scatterAngle = Math.random() * Math.PI * 2;
      const scatterRadius = size * 0.007 * Math.random();

      dots.push({
        x: leaf.homeX + Math.cos(scatterAngle) * scatterRadius,
        y: leaf.homeY + Math.sin(scatterAngle) * scatterRadius,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX: leaf.homeX,
        homeY: leaf.homeY,
        foldX: leaf.foldX,
        foldY: leaf.foldY,
        part: 'leaf',
        canopyBias: leaf.canopyBias,
        swayAmplitude: size * (0.0035 + leaf.canopyBias * 0.011),
        swayPhase: Math.random() * Math.PI * 2,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.013 + Math.random() * 0.012,
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
          const distToFold = Math.hypot(dot.x - dot.foldX, dot.y - dot.foldY);
          const moveSpeed = dot.part === 'leaf'
            ? 0.032 * cycle * Math.min(1, distToFold / (size * 0.032))
            : 0.018 * cycle * Math.min(1, distToFold / (size * 0.022));

          dot.x += (dot.foldX - dot.x) * moveSpeed;
          dot.y += (dot.foldY - dot.y) * moveSpeed;
        } else {
          const swayX = Math.sin(time * 0.62 + dot.swayPhase) * dot.swayAmplitude;
          const swayY = Math.cos(time * 0.43 + dot.swayPhase) * dot.swayAmplitude * 0.22;
          const targetX = dot.homeX + swayX;
          const targetY = dot.homeY + swayY;
          const moveSpeed = dot.part === 'leaf'
            ? 0.026 * Math.abs(cycle)
            : 0.016 * Math.abs(cycle);

          dot.x += (targetX - dot.x) * moveSpeed;
          dot.y += (targetY - dot.y) * moveSpeed;

          const dx = dot.x - canopyCenterX;
          const dy = dot.y - canopyCenterY;
          const angle = Math.atan2(dy, dx);
          const driftMix = dot.part === 'leaf'
            ? computeDrift(angle, dot.z, time, dot.phase, 2, 3, 0.0048, 0.0036)
            : computeDrift(angle, dot.z, time, dot.phase, 2, 2, 0.0018, 0.0012);
          dot.x += dx * driftMix;
          dot.y += dy * driftMix;

          const distFromHome = Math.hypot(dot.x - targetX, dot.y - targetY);
          const homeRadius = dot.part === 'leaf' ? size * 0.085 : size * 0.03;
          const pull = containmentPull(distFromHome / homeRadius, 1.0, 5) * 0.075;
          dot.x += (targetX - dot.x) * pull;
          dot.y += (targetY - dot.y) * pull;
        }

        dot.z = stepZ(
          dot.z,
          time,
          dot.phase,
          dot.canopyBias + Math.abs(cycle),
          0.18,
          0.012,
        );

        const df = depthFactor(dot.z, dot.part === 'leaf' ? 0.52 : 0.42);
        const opacity = dot.part === 'leaf'
          ? Math.max(0.025, 0.29 * Math.abs(cycle) + 0.05 * df)
          : Math.max(0.02, 0.13 * Math.abs(cycle) + 0.04 * df);
        const radius = dot.part === 'leaf'
          ? dotRadius(size, df, 960, 0.28)
          : dotRadius(size, df, 1040, 0.24);

        drawDot(ctx, dot.x, dot.y, radius, opacity);
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
