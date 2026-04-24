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
const MAX_DEPTH = 5;

// ── Recursive branching ───────────────────────────────────────────────────────
// Cherry blossom: relatively upright habit (low spread angle), flowers appear
// on bare branches.  25 % chance of 3-way branching at non-terminal nodes
// gives a more realistic canopy density.

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  depth: number;
}

function growBranch(
  segs: Segment[],
  tips: Array<{ x: number; y: number }>,
  x: number,
  y: number,
  angle: number,
  len: number,
  depth: number,
): void {
  const endX = x + Math.cos(angle) * len;
  const endY = y + Math.sin(angle) * len;
  segs.push({ x1: x, y1: y, x2: endX, y2: endY, depth });
  if (depth >= MAX_DEPTH) { tips.push({ x: endX, y: endY }); return; }
  const nextLen = len * (0.60 + Math.random() * 0.10);
  const spread = 0.26 + Math.random() * 0.16;
  const drift = (Math.random() - 0.5) * 0.12;
  if (Math.random() < 0.25 && depth < MAX_DEPTH - 1) {
    growBranch(segs, tips, endX, endY, angle + spread + drift, nextLen, depth + 1);
    growBranch(segs, tips, endX, endY, angle + drift * 0.3, nextLen * 0.88, depth + 1);
    growBranch(segs, tips, endX, endY, angle - spread + drift, nextLen, depth + 1);
  } else {
    growBranch(segs, tips, endX, endY, angle + spread + drift, nextLen, depth + 1);
    growBranch(segs, tips, endX, endY, angle - spread + drift, nextLen, depth + 1);
  }
}

interface BlossomDot {
  x: number;
  y: number;
  z: number;
  phase: number;
  homeX: number;
  homeY: number;
  foldX: number;
  foldY: number;
  part: 'wood' | 'flower';
  depthBias: number;
  swayAmplitude: number;
  swayPhase: number;
  convergencePhase: number;
  convergenceSpeed: number;
}

export function CherryBlossomLoadingArt({
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
    const trunkBase = fh / 2 + size * 0.37;

    setupCanvas(canvas, ctx, fw, fh, deviceScale);

    // ── Build branch tree ────────────────────────────────────────────────────
    const segments: Segment[] = [];
    const tips: Array<{ x: number; y: number }> = [];
    growBranch(segments, tips, cx, trunkBase, -Math.PI / 2, size * 0.20, 0);

    const totalDots = Math.max(10000, Math.round((fw * fh) / 9));
    const woodCount = Math.round(totalDots * 0.60);
    const flowerCount = totalDots - woodCount;
    const dots: BlossomDot[] = [];

    // ── Branch dots: weighted by length × thickness ──────────────────────────
    // Segments near the trunk (low depth) are thicker, so they get more dots.
    const segWeights = segments.map((s) => {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      return len * (MAX_DEPTH - s.depth + 1) ** 1.5;
    });
    const totalW = segWeights.reduce((a, b) => a + b, 0);

    for (let i = 0; i < woodCount; i++) {
      let r = Math.random() * totalW;
      let si = 0;
      while (si < segments.length - 1 && r > segWeights[si]) {
        r -= segWeights[si];
        si++;
      }
      const seg = segments[si];
      const t = Math.random();
      const bx = seg.x1 + (seg.x2 - seg.x1) * t;
      const by = seg.y1 + (seg.y2 - seg.y1) * t;

      const dxSeg = seg.x2 - seg.x1;
      const dySeg = seg.y2 - seg.y1;
      const segLen = Math.hypot(dxSeg, dySeg) || 1;
      const nx = -dySeg / segLen;
      const ny = dxSeg / segLen;
      const thickness = (MAX_DEPTH - seg.depth + 1) * size * 0.0026;
      const scatter = (Math.random() * 2 - 1) * thickness;
      const homeX = bx + nx * scatter;
      const homeY = by + ny * scatter;
      const depthBias = 1 - seg.depth / MAX_DEPTH;

      dots.push({
        x: homeX, y: homeY,
        z: Math.random() * 2 - 1,
        phase: Math.random() * Math.PI * 2,
        homeX, homeY,
        // Fold: branch compresses toward the trunk centreline during inhale.
        foldX: cx, foldY: homeY,
        part: 'wood',
        depthBias,
        swayAmplitude: size * (0.002 + (1 - depthBias) * 0.012),
        swayPhase: Math.random() * Math.PI * 2,
        convergencePhase: Math.random() * Math.PI * 2,
        convergenceSpeed: 0.011 + Math.random() * 0.010,
      });
    }

    // ── Flower clusters: 5 petals per terminal tip ───────────────────────────
    // Each petal is sampled parametrically (no rejection), same approach as
    // SunflowerLoadingArt.  Fold: petals close back to their branch tip.
    const flowerR = size * 0.018;
    const petalLen = size * 0.020;
    const petalHW = size * 0.009;
    const tipsCount = Math.max(1, tips.length);
    const dotsPerPetal = Math.ceil(flowerCount / tipsCount / 5);

    for (const tip of tips) {
      for (let p = 0; p < 5; p++) {
        const petalAngle = (p / 5) * Math.PI * 2 - Math.PI / 2;
        const cosA = Math.cos(petalAngle);
        const sinA = Math.sin(petalAngle);
        const petalCX = tip.x + cosA * flowerR;
        const petalCY = tip.y + sinA * flowerR;
        for (let d = 0; d < dotsPerPetal; d++) {
          const tLen = Math.random();
          const hw = Math.sin(Math.PI * tLen) * petalHW;
          const along = (tLen - 0.5) * petalLen;
          const across = (Math.random() * 2 - 1) * hw;
          const homeX = petalCX + cosA * along - sinA * across;
          const homeY = petalCY + sinA * along + cosA * across;
          dots.push({
            x: homeX, y: homeY,
            z: Math.random() * 2 - 1,
            phase: Math.random() * Math.PI * 2,
            homeX, homeY,
            foldX: tip.x, foldY: tip.y,
            part: 'flower',
            depthBias: 0.88,
            swayAmplitude: size * 0.008,
            swayPhase: Math.random() * Math.PI * 2,
            convergencePhase: Math.random() * Math.PI * 2,
            convergenceSpeed: 0.014 + Math.random() * 0.012,
          });
        }
      }
    }

    const treeMidY = trunkBase - size * 0.20;
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
          const dist = Math.hypot(dot.x - dot.foldX, dot.y - dot.foldY);
          const spd = dot.part === 'flower'
            ? 0.034 * cycle * Math.min(1, dist / (size * 0.030))
            : 0.020 * cycle * Math.min(1, dist / (size * 0.025));
          dot.x += (dot.foldX - dot.x) * spd;
          dot.y += (dot.foldY - dot.y) * spd;
        } else {
          const sx = Math.sin(time * 0.58 + dot.swayPhase) * dot.swayAmplitude;
          const sy = Math.cos(time * 0.44 + dot.swayPhase) * dot.swayAmplitude * 0.28;
          const tx = dot.homeX + sx;
          const ty = dot.homeY + sy;
          const spd = dot.part === 'flower'
            ? 0.030 * Math.abs(cycle)
            : 0.018 * Math.abs(cycle);
          dot.x += (tx - dot.x) * spd;
          dot.y += (ty - dot.y) * spd;

          const dx = dot.x - cx;
          const dy = dot.y - treeMidY;
          const dm = computeDrift(
            Math.atan2(dy, dx), dot.z, time, dot.phase, 2, 3,
            dot.part === 'flower' ? 0.0044 : 0.0016,
            dot.part === 'flower' ? 0.0032 : 0.0010,
          );
          dot.x += dx * dm;
          dot.y += dy * dm;
        }

        dot.z = stepZ(dot.z, time, dot.phase, dot.depthBias + Math.abs(cycle), 0.18, 0.012);
        const df = depthFactor(dot.z, dot.part === 'flower' ? 0.54 : 0.40);
        const op = dot.part === 'flower'
          ? Math.max(0.025, 0.31 * Math.abs(cycle) + 0.060 * df)
          : Math.max(0.018, 0.14 * Math.abs(cycle) + 0.040 * df);
        const r = dot.part === 'flower'
          ? dotRadius(size, df, 930, 0.27)
          : dotRadius(size, df, 1060, 0.22);
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
