import type { Vec2 } from './types';

export const TAU = Math.PI * 2;
export const EPS = 1e-9;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

/** 归一化到 (-pi, pi]。 */
export function normAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  if (r > Math.PI) r -= TAU;
  return r;
}

/** 把 a 限制在 [min,max] 内（假定 max-min <= 2*pi）。 */
export function clampAngle(a: number, min: number, max: number): number {
  if (a < min) return min;
  if (a > max) return max;
  return a;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 沿最短弧从 a 插值到 b。 */
export function lerpAngle(a: number, b: number, u: number): number {
  return normAngle(a + normAngle(b - a) * u);
}

export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** 世界坐标 -> 屏幕坐标：Canvas 的 y 轴向下，因此翻转 y。 */
export function worldToScreen(p: Vec2, origin: Vec2, zoom: number): Vec2 {
  return { x: origin.x + p.x * zoom, y: origin.y - p.y * zoom };
}

export function screenToWorld(p: Vec2, origin: Vec2, zoom: number): Vec2 {
  return { x: (p.x - origin.x) / zoom, y: (origin.y - p.y) / zoom };
}

export function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function rad(degVal: number): number {
  return (degVal * Math.PI) / 180;
}
