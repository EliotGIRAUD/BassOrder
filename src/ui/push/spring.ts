/** Physique partagée des interactions “push → spring → snap”. */

export const SPRING = 58;
export const DAMP = 7.2;
export const SNAP_SPRING = 72;
export const SNAP_DAMP = 6.4;

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function stepSpring(
  display: number,
  velocity: number,
  target: number,
  dt: number,
  snapping: boolean,
  reduce: boolean,
  looseMin = -4,
  looseMax = 108,
): { display: number; velocity: number } {
  if (reduce) {
    return { display: target, velocity: 0 };
  }
  const spring = snapping ? SNAP_SPRING : SPRING;
  const damp = snapping ? SNAP_DAMP : DAMP;
  const nextV = velocity + ((target - display) * spring - velocity * damp) * dt;
  const next = clamp(display + nextV * dt, looseMin, looseMax);
  return { display: next, velocity: nextV };
}

export function isSettled(
  display: number,
  velocity: number,
  real: number,
  eps = 0.35,
  vEps = 2,
): boolean {
  return Math.abs(display - real) < eps && Math.abs(velocity) < vEps;
}

export function snapImpulse(real: number, display: number, scale = 0.35): number {
  return clamp((real - display) * scale, -40, 40);
}
