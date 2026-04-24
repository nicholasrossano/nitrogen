/**
 * Shared animation physics for the loading-art family.
 *
 * ── Core design rules ────────────────────────────────────────────────────────
 *   - Shape is NEVER drawn — it emerges from density bias alone.
 *   - Dots have MUTABLE STATE — positions accumulate drift, never recomputed
 *     from a formula each frame.
 *   - `destination-out` fade — no clearRect, no background tint.
 *   - Drift = two competing sinusoidal oscillations blended by depth.
 *   - Containment = soft power-law pull, inactive in the interior.
 *   - z breathes independently, driving opacity and dot size.
 *
 * ── Botanical home / fold breathing pattern ───────────────────────────────
 *   All botanically-shaped pieces (Fern, Dahlia, Bamboo, Wisteria, …) use a
 *   two-position breathing model seeded at init time:
 *
 *     homeX / homeY  — the full, open botanical silhouette. Seeded from the
 *                      plant's actual geometry (IFS attractor, petal rings,
 *                      raceme envelope, culm + leaf curves, …).
 *
 *     foldX / foldY  — the compressed "inhale" position. Always a botanically
 *                      meaningful contraction, NOT a generic radial pull toward
 *                      canvas centre:
 *                        • Fern   → project laterally onto the central rachis
 *                        • Dahlia → pull radially toward canvas centre (petals
 *                                   folding into a bud) with a ring-dependent
 *                                   fold fraction (outer petals close more)
 *                        • Wisteria → compress horizontally toward the stem axis
 *                        • Bamboo → leaves retract toward their culm node;
 *                                   culms compress to their centreline
 *
 *   Animation loop (uses stepConvergence):
 *     isConverging → pull toward foldX/foldY  (inhale — shape closes)
 *     releasing    → spring toward homeX/homeY (exhale — shape blooms open)
 *                    + shimmer drift layered on the release phase only
 *
 *   Speed: proportional to current distance so far-away dots snap back faster,
 *   giving the characteristic "rush then settle" feel of iris-style breathing.
 *   All dots are desynchronised via random initial convergencePhase.
 *
 * ── What changes per piece ───────────────────────────────────────────────────
 *   Seeding geometry, home/fold targets, fold fractions, convergence speeds,
 *   sway amplitude, point count, fade rate, and drift strengths.
 */

// ── Shared constants ─────────────────────────────────────────────────────────

/** Containment threshold multiplier (dandelion origin). Containment is ~0 below
 *  `ratio / BLOOM_SCALE` and ramps up beyond it. */
export const BLOOM_SCALE = 2.4;

/** Default alpha for destination-out fade per frame. Lower = longer trails. */
export const DEFAULT_FADE_ALPHA = 0.15;

/** Base opacity multiplier for dot rendering. */
export const BASE_OPACITY = 0.35;

/** `size / DOT_SCALE` gives base dot radius before depth scaling. */
export const DOT_SCALE = 920;

/** Minimum rendered dot radius in CSS pixels. */
export const MIN_DOT_RADIUS = 0.35;

/** Minimum rendered dot opacity. */
export const MIN_DOT_OPACITY = 0.06;

// ── Canvas setup ─────────────────────────────────────────────────────────────

export function setupCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  frameWidth: number,
  frameHeight: number,
  deviceScale: number,
): void {
  canvas.width = Math.round(frameWidth * deviceScale);
  canvas.height = Math.round(frameHeight * deviceScale);
  canvas.style.width = `${frameWidth}px`;
  canvas.style.height = `${frameHeight}px`;
  ctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
}

// ── Fade ─────────────────────────────────────────────────────────────────────

/** Apply the family-standard destination-out fade. Call once per drawFrame. */
export function applyFade(
  ctx: CanvasRenderingContext2D,
  frameWidth: number,
  frameHeight: number,
  alpha = DEFAULT_FADE_ALPHA,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.fillRect(0, 0, frameWidth, frameHeight);
  ctx.restore();
}

// ── Drift ────────────────────────────────────────────────────────────────────

/**
 * Dandelion-origin drift: two competing sinusoidal oscillations blended by depth.
 * Returns a scalar `driftMix` to apply as `dot.x += dx * driftMix; dot.y += dy * driftMix`.
 *
 * @param angle       atan2(dy, dx) from the dot's anchor point
 * @param depth       normalised depth (z / zRange), drives the phase blend
 * @param time        global time accumulator
 * @param phase       per-dot phase offset (0 if not used)
 * @param angleFreqA  angular multiplier for oscillation A (default 2)
 * @param angleFreqB  angular multiplier for oscillation B (default 2)
 * @param strengthA   amplitude of oscillation A (default 0.015)
 * @param strengthB   amplitude of oscillation B (default 0.015)
 */
export function computeDrift(
  angle: number,
  depth: number,
  time: number,
  phase = 0,
  angleFreqA = 2,
  angleFreqB = 2,
  strengthA = 0.015,
  strengthB = 0.015,
): number {
  const driftA = Math.sin(angleFreqA * angle - time * 0.5 + depth * 2 + phase) * strengthA;
  const driftB = Math.cos(angleFreqB * angle + time * 0.5 - depth * 2 + phase) * strengthB;
  const blend = (Math.sin(depth * Math.PI) + 1) * 0.5;
  return driftA * blend + driftB * (1 - blend);
}

// ── Containment ──────────────────────────────────────────────────────────────

/**
 * Soft power-law containment. Returns a pull multiplier in [0, 1].
 * Effectively 0 while `ratio < threshold`, ramps to 1 at `ratio = threshold`.
 *
 * Usage:
 *   const ratio = distFromHome / homeRadius;
 *   const pull = containmentPull(ratio) * pullStrength;
 *   dot.x -= (dot.x - homeX) * pull;
 *
 * @param ratio      distFromHome / homeRadius  (unitless)
 * @param threshold  ratio at which pull reaches full strength (default BLOOM_SCALE * 0.8)
 * @param power      steepness of the ramp (default 4 — zero until near boundary)
 */
export function containmentPull(
  ratio: number,
  threshold = BLOOM_SCALE * 0.8,
  power = 4,
): number {
  return Math.pow(Math.min(1, ratio / threshold), power);
}

// ── z breathing ──────────────────────────────────────────────────────────────

/**
 * Advance z by one frame of independent breathing.
 * z drives depthFactor → opacity + dot size, creating shimmer without movement.
 *
 * @param z          current z value
 * @param time       global time accumulator
 * @param phase      per-dot phase offset
 * @param bias       additional phase bias (e.g. radiusRatio * 2 in dandelion)
 * @param timeScale  how fast z oscillates (default 0.15)
 * @param step       max change per frame (default 0.01)
 */
export function stepZ(
  z: number,
  time: number,
  phase: number,
  bias = 0,
  timeScale = 0.15,
  step = 0.01,
): number {
  return z + Math.sin(time * timeScale + phase + bias) * step;
}

// ── Depth / rendering ────────────────────────────────────────────────────────

/**
 * Depth factor from z. Maps z → a multiplier > 0 that scales opacity and size.
 * Matches dandelion/lotus: `1 + z * zScale`.
 *
 * @param z       raw z value of the dot
 * @param zScale  how strongly z affects apparent depth (default 0.5)
 */
export function depthFactor(z: number, zScale = 0.5): number {
  return 1 + z * zScale;
}

/**
 * Dot opacity from depthFactor. Enforces a minimum floor.
 *
 * @param df          depthFactor value
 * @param base        base opacity multiplier (default BASE_OPACITY = 0.35)
 * @param minOpacity  floor (default MIN_DOT_OPACITY = 0.06)
 */
export function dotOpacity(
  df: number,
  base = BASE_OPACITY,
  minOpacity = MIN_DOT_OPACITY,
): number {
  return Math.max(minOpacity, base * df);
}

/**
 * Dot radius from depthFactor and canvas size.
 *
 * @param size      canvas size (the `size` prop)
 * @param df        depthFactor value
 * @param scale     divisor mapping size → base radius (default DOT_SCALE = 920)
 * @param minRadius floor radius in CSS px (default MIN_DOT_RADIUS = 0.35)
 */
export function dotRadius(
  size: number,
  df: number,
  scale = DOT_SCALE,
  minRadius = MIN_DOT_RADIUS,
): number {
  return Math.max(minRadius, (size / scale) * df);
}

// ── Global breathing ─────────────────────────────────────────────────────────

/**
 * Current breathing scalar for this frame: `1 ± amplitude`.
 * Combine with `breatheDelta` (below) to apply radial expansion/contraction.
 *
 * @param time       global time accumulator
 * @param amplitude  max fractional change (e.g. 0.08 = ±8%)
 * @param frequency  angular frequency of the sine (higher = faster cycles)
 */
export function breatheScalar(
  time: number,
  amplitude: number,
  frequency: number,
): number {
  return 1 + Math.sin(time * frequency) * amplitude;
}

/**
 * Apply a radial scale delta to a dot in-place.
 * Call BEFORE drift/containment each frame:
 *
 *   const breathe     = breatheScalar(time, 0.08, 0.95);
 *   const delta       = breathe / prevBreathe;
 *   prevBreathe       = breathe;
 *   applyRadialScale(dot, cx, cy, delta);
 */
export function applyRadialScale(
  dot: { x: number; y: number },
  cx: number,
  cy: number,
  delta: number,
): void {
  dot.x = cx + (dot.x - cx) * delta;
  dot.y = cy + (dot.y - cy) * delta;
}

// ── Iris-style per-dot convergence ───────────────────────────────────────────

/**
 * Advance a per-dot convergence phase and return the current cycle value.
 * Each dot has its own `convergencePhase` and `convergenceSpeed` so they are
 * all desynchronized — at any frame ~50% are converging and ~50% releasing.
 *
 * @param phase  current convergencePhase for this dot
 * @param speed  per-frame phase increment (e.g. 0.008 + random * 0.008)
 * @returns      { cycle: sin value -1..1, isConverging: cycle > 0, nextPhase }
 */
export function stepConvergence(
  phase: number,
  speed: number,
): { cycle: number; isConverging: boolean; nextPhase: number } {
  const nextPhase = phase + speed;
  const cycle = Math.sin(nextPhase);
  return { cycle, isConverging: cycle > 0, nextPhase };
}

// ── Rendering helper ─────────────────────────────────────────────────────────

/**
 * Draw a single dot. Caller is responsible for setting `ctx.fillStyle` once before
 * the loop and resetting `ctx.globalAlpha = 1` after.
 */
export function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  opacity: number,
): void {
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
