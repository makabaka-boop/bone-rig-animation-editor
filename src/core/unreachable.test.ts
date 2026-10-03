import { describe, expect, it } from 'vitest';
import { solveTwoBoneIK } from './ik';
import { createDoc } from './doc';
import type { Bone, Doc } from './types';

function setup(l1 = 100, l2 = 60): { doc: Doc; p: Bone; d: Bone } {
  const doc = createDoc();
  const [p, d] = Object.keys(doc.bones);
  doc.bones[p].length = l1;
  doc.bones[d].length = l2;
  return { doc, p: doc.bones[p], d: doc.bones[d] };
}

const FREE = { min: -Math.PI, max: Math.PI };

describe('两节骨 IK：不可达目标', () => {
  it('目标超出 l1+l2：末端贴在外边界（距离 = l1+l2）', () => {
    const { p, d } = setup(100, 60);
    const res = solveTwoBoneIK({
      pivot: { x: 0, y: 0 },
      parentWorldAngle: 0,
      l1: 100,
      l2: 60,
      target: { x: 1000, y: 0 },
      proximal: { ...p, limit: FREE },
      distal: { ...d, limit: FREE },
      currentProximal: 0,
      currentDistal: 0.1,
    });
    expect(res.clamped).toBe(true);
    const reachDist = Math.hypot(res.reach.x, res.reach.y);
    expect(reachDist).toBeCloseTo(160, 9);
    expect(res.reach.x).toBeCloseTo(160, 9);
    expect(res.reach.y).toBeCloseTo(0, 9);
    // 完全伸直：远端局部角 0，近端指向目标
    expect(res.angles.distal).toBeCloseTo(0, 9);
    expect(res.angles.proximal).toBeCloseTo(0, 9);
  });

  it('斜向超距：贴边点位于目标方向上', () => {
    const { p, d } = setup(100, 100);
    const dir = Math.atan2(1, 1); // 45°
    const res = solveTwoBoneIK({
      pivot: { x: 0, y: 0 },
      parentWorldAngle: 0,
      l1: 100,
      l2: 100,
      target: { x: 500 * Math.cos(dir), y: 500 * Math.sin(dir) },
      proximal: { ...p, limit: FREE },
      distal: { ...d, limit: FREE },
      currentProximal: 0,
      currentDistal: 0,
    });
    expect(res.clamped).toBe(true);
    expect(Math.hypot(res.reach.x, res.reach.y)).toBeCloseTo(200, 9);
    expect(Math.atan2(res.reach.y, res.reach.x)).toBeCloseTo(dir, 9);
  });

  it('目标近于 |l1-l2|：贴在内边界并向后折叠', () => {
    const { p, d } = setup(100, 60);
    const res = solveTwoBoneIK({
      pivot: { x: 0, y: 0 },
      parentWorldAngle: 0,
      l1: 100,
      l2: 60,
      target: { x: 5, y: 0 },
      proximal: { ...p, limit: FREE },
      distal: { ...d, limit: FREE },
      currentProximal: 0,
      currentDistal: 0,
    });
    expect(res.clamped).toBe(true);
    expect(Math.hypot(res.reach.x, res.reach.y)).toBeCloseTo(40, 9); // |100-60|
    expect(Math.abs(res.angles.distal)).toBeCloseTo(Math.PI, 9);
  });

  it('可达目标：余弦定理精确命中；弯向跟随当前姿态且平局时取最小运动量', () => {
    const { p, d } = setup(100, 100);
    const res = solveTwoBoneIK({
      pivot: { x: 0, y: 0 },
      parentWorldAngle: 0,
      l1: 100,
      l2: 100,
      target: { x: 100, y: 100 },
      proximal: { ...p, limit: FREE },
      distal: { ...d, limit: FREE },
      currentProximal: 0,
      currentDistal: 0.5, // 正向弯
    });
    expect(res.clamped).toBe(false);
    expect(res.reach.x).toBeCloseTo(100, 9);
    expect(res.reach.y).toBeCloseTo(100, 9);
    // 两组解都精确命中；最小运动量选出肘在 (100,0)：近端 0°、远端 +90°。
    expect(res.angles.proximal).toBeCloseTo(0, 9);
    expect(res.angles.distal).toBeCloseTo(Math.PI / 2, 9);

    // 即使从反向弯姿态起步，最小运动量仍选近端不动的解：
    const mirrored = solveTwoBoneIK({
      pivot: { x: 0, y: 0 },
      parentWorldAngle: 0,
      l1: 100,
      l2: 100,
      target: { x: 100, y: 100 },
      proximal: { ...p, limit: FREE },
      distal: { ...d, limit: FREE },
      currentProximal: Math.PI / 2, // 近端已在 90° 时则选出镜像解
      currentDistal: -0.5,
    });
    expect(mirrored.angles.proximal).toBeCloseTo(Math.PI / 2, 9);
    expect(mirrored.angles.distal).toBeCloseTo(-Math.PI / 2, 9);
    expect(mirrored.reach.y).toBeCloseTo(100, 9);
  });
});
