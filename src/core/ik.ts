import type { Bone, Vec2 } from './types';
import { dist, normAngle, TAU } from './geometry';
import type { LocalPose } from './fk';

export interface TwoBoneChain {
  /** 近端骨（靠近根）。 */
  proximalId: string;
  /** 远端骨（末端控制点所在骨）。 */
  distalId: string;
}

export interface IKResult {
  /** 求解后的局部角度（仅包含两节骨）。 */
  angles: { proximal: number; distal: number };
  /** 实际到达点（不可达时为边界上的最近点）。 */
  reach: Vec2;
  /** 目标是否超出可达距离。 */
  clamped: boolean;
}

/**
 * 两节骨逆向定位（analytic 2-bone IK）。
 *
 * 输入为近端骨的起点 P、近端骨父级世界角、两节骨当前长度以及目标点。
 * 先处理超出可达距离的情况：目标投影到可达包络边界
 * （距离 > l1+l2 沿径向贴边；距离 < |l1-l2| 贴内边界）。
 * 然后用余弦定理求肘弯角；若两节骨分别带有关节角度限制，
 * 则在肘部配置空间中取离目标最近的可行解，保证结果永远在约束边界之内。
 *
 * 角度约定与 FK 一致：局部角相对父骨世界角；远端局部角相对近端世界角。
 * 弯向（肘部在上/下）由当前姿态决定，取与当前肘侧一致的解。
 */
export function solveTwoBoneIK(params: {
  pivot: Vec2;
  parentWorldAngle: number;
  l1: number;
  l2: number;
  target: Vec2;
  proximal: Bone;
  distal: Bone;
  currentProximal: number;
  currentDistal: number;
}): IKResult {
  const { pivot, parentWorldAngle, l1, l2, target, proximal, distal } = params;

  const rawD = dist(pivot, target);
  const outer = l1 + l2;
  const inner = Math.abs(l1 - l2);
  let d = rawD;
  let clamped = false;
  if (d > outer) {
    d = outer;
    clamped = true;
  } else if (d < inner) {
    d = inner;
    clamped = true;
  }

  // 目标方向（世界）。退化情况（pivot 与目标重合）沿用当前朝向。
  let dirWorld: number;
  if (rawD < 1e-12) {
    dirWorld = parentWorldAngle + params.currentProximal;
  } else {
    dirWorld = Math.atan2(target.y - pivot.y, target.x - pivot.x);
  }

  // 余弦定理：
  //  alpha = 近端骨与 pivot->目标 方向的夹角（P 点内角）
  //  gamma = 肘部内角；远端骨相对近端的弯折量 = pi - gamma。
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d || 1);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const cosG = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2 || 1);
  const gamma = Math.acos(Math.max(-1, Math.min(1, cosG)));
  const bendMag = Math.PI - gamma;

  // 当前肘部弯侧：用当前角的符号决定，默认正弯（逆时针）。
  const currentBend = normAngle(params.currentDistal);
  const bendSign = currentBend < 0 ? -1 : +1;

  // 两个候选肘部配置（近端在目标方向两侧 ±alpha，远端反向弯折）。
  const candidates: Array<{ a1: number; bend: number }> = [
    { a1: dirWorld - parentWorldAngle + alpha * bendSign, bend: -bendMag * bendSign },
    { a1: dirWorld - parentWorldAngle - alpha * bendSign, bend: bendMag * bendSign },
  ];

  const clampToLimit = (a: number, min: number, max: number): number => {
    const n = normAngle(a);
    if (n < min) {
      // 约束可能跨过 ±pi：等价表示 n+2*pi 也许在范围内。
      if (n + TAU <= max) return Math.min(n + TAU, max);
      return min;
    }
    if (n > max) {
      if (n - TAU >= min) return Math.max(n - TAU, min);
      return max;
    }
    return n;
  };

  const applyLimits = (c: { a1: number; bend: number }) => {
    const a1 = clampToLimit(c.a1, proximal.limit.min, proximal.limit.max);
    const a2 = clampToLimit(c.bend, distal.limit.min, distal.limit.max);
    return { a1, a2 };
  };

  // 由一组局部角推算实际末端，用于在受限解之间比较谁更接近目标。
  const endpointOf = (a1: number, a2: number): Vec2 => {
    const w1 = parentWorldAngle + a1;
    const elbow = {
      x: pivot.x + Math.cos(w1) * l1,
      y: pivot.y + Math.sin(w1) * l1,
    };
    const w2 = w1 + a2;
    return {
      x: elbow.x + Math.cos(w2) * l2,
      y: elbow.y + Math.sin(w2) * l2,
    };
  };

  /**
   * CCD 式精修：交替转动远端（绕肘）与近端（绕根），每步都夹回关节限制。
   * 解析候选在两节同时被限定时未必是最近点，精修保证收敛到
   * 约束边界上的可达最近点。
   */
  const refine = (seed: { a1: number; a2: number }) => {
    let a1 = seed.a1;
    let a2 = seed.a2;
    const toTargetFrom = (p: Vec2) => {
      const m = Math.hypot(target.x - p.x, target.y - p.y);
      return m < 1e-12 ? 0 : Math.atan2(target.y - p.y, target.x - p.x);
    };
    for (let i = 0; i < 16; i++) {
      // 远端：绕肘把末端转向目标
      const w1 = parentWorldAngle + a1;
      const elbow = { x: pivot.x + Math.cos(w1) * l1, y: pivot.y + Math.sin(w1) * l1 };
      let delta = normAngle(toTargetFrom(elbow) - normAngle(w1 + a2));
      a2 = clampToLimit(a2 + delta, distal.limit.min, distal.limit.max);

      // 近端：绕根旋转整条子链把末端转向目标，再补偿远端以尽量保持其世界方向。
      const end = endpointOf(a1, a2);
      const curAng = Math.atan2(end.y - pivot.y, end.x - pivot.x);
      delta = normAngle(toTargetFrom(pivot) - curAng);
      const a1New = clampToLimit(a1 + delta, proximal.limit.min, proximal.limit.max);
      const applied = a1New - a1;
      a1 = a1New;
      a2 = clampToLimit(a2 - applied, distal.limit.min, distal.limit.max);
    }
    return { a1, a2 };
  };

  const scored = candidates.map((c) => {
    const { a1, a2 } = refine(applyLimits(c));
    const reach = endpointOf(a1, a2);
    return {
      a1,
      a2,
      reach,
      err: dist(reach, target),
      motion: Math.abs(normAngle(a1 - params.currentProximal)) + Math.abs(normAngle(a2 - params.currentDistal)),
    };
  });
  // 先按到目标的误差，再按偏离当前姿态的运动量（误差在容差内视为平局）。
  scored.sort((p, q) => {
    if (Math.abs(p.err - q.err) > 1e-7) return p.err - q.err;
    return p.motion - q.motion;
  });
  const best = scored[0];

  // 不可达（含约束导致够不到）时，reach 即为边界上的最近可达点。
  const finalClamped = clamped || best.err > 1e-9;

  return {
    angles: { proximal: best.a1, distal: best.a2 },
    reach: best.reach,
    clamped: finalClamped,
  };
}

/** 找到某根骨向上数的两节链（父->自身）；根或根的独子没有两节链。 */
export function chainEndingAt(doc: { bones: Record<string, Bone> }, endBoneId: string): TwoBoneChain | null {
  const distal = doc.bones[endBoneId];
  if (!distal || distal.parentId == null) return null;
  const proximal = doc.bones[distal.parentId];
  if (!proximal) return null;
  return { proximalId: proximal.id, distalId: distal.id };
}

/**
 * 对两节骨链执行 IK，并把结果写回局部姿态（其余骨骼不动）。
 * pivot 使用近端骨在给定姿态下的起点，parentWorldAngle 取其父级世界角
 * （近端骨即根时为 0）。返回 null 表示该末端不构成两节链。
 */
export function applyIKToLocal(
  doc: import('./types').Doc,
  local: LocalPose,
  endBoneId: string,
  target: Vec2,
  worldPose: import('./types').SkeletonPose,
): (IKResult & { chain: TwoBoneChain }) | null {
  const chain = chainEndingAt(doc, endBoneId);
  if (!chain) return null;
  const proxBone = doc.bones[chain.proximalId];
  const distBone = doc.bones[chain.distalId];
  const proxPose = worldPose.bones[chain.proximalId];
  const parentWorld = proxBone.parentId == null
    ? 0
    : worldPose.bones[proxBone.parentId].worldAngle;

  const res = solveTwoBoneIK({
    pivot: proxPose.start,
    parentWorldAngle: parentWorld,
    l1: local.lengths[chain.proximalId] ?? proxBone.length,
    l2: local.lengths[chain.distalId] ?? distBone.length,
    target,
    proximal: proxBone,
    distal: distBone,
    currentProximal: local.angles[chain.proximalId] ?? 0,
    currentDistal: local.angles[chain.distalId] ?? 0,
  });

  local.angles[chain.proximalId] = res.angles.proximal;
  local.angles[chain.distalId] = res.angles.distal;
  return { ...res, chain };
}
