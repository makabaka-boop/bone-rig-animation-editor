import { describe, expect, it } from 'vitest';
import { solveTwoBoneIK, applyIKToLocal } from './ik';
import { createDoc, setLimit, validateDoc, setParent, deleteBone, addBone, upsertFrame } from './doc';
import { poseAt } from './fk';
import { rad, normAngle } from './geometry';

const FREE = { min: -Math.PI, max: Math.PI };

describe('关节角度约束边界', () => {
  it('远端关节被锁在 0：无法弯曲，末端沿直线最近接近目标', () => {
    const doc = createDoc();
    const [p, d] = Object.keys(doc.bones);
    const locked = { min: 0, max: 0 };
    const res = solveTwoBoneIK({
      pivot: { x: 0, y: 0 },
      parentWorldAngle: 0,
      l1: 100,
      l2: 100,
      target: { x: 100, y: 100 },
      proximal: { ...doc.bones[p], limit: FREE },
      distal: { ...doc.bones[d], limit: locked },
      currentProximal: 0,
      currentDistal: 0,
    });
    expect(res.angles.distal).toBe(0);
    // 最接近 (100,100) 的伸直姿态是指向 45°，距离目标 200-141.4
    expect(normAngle(res.angles.proximal)).toBeCloseTo(Math.PI / 4, 9);
    expect(res.reach.x).toBeCloseTo(200 * Math.SQRT1_2, 8);
    expect(res.reach.y).toBeCloseTo(200 * Math.SQRT1_2, 8);
    expect(res.clamped).toBe(true);
  });

  it('近端关节被锁在 0：只能转动远端，且结果不越过约束', () => {
    const doc = createDoc();
    const [p, d] = Object.keys(doc.bones);
    const res = solveTwoBoneIK({
      pivot: { x: 0, y: 0 },
      parentWorldAngle: 0,
      l1: 100,
      l2: 100,
      target: { x: 100, y: 100 },
      proximal: { ...doc.bones[p], limit: { min: 0, max: 0 } },
      distal: { ...doc.bones[d], limit: FREE },
      currentProximal: 0,
      currentDistal: 0,
    });
    expect(res.angles.proximal).toBe(0);
    // 肘在 (100,0)，远端竖直指向目标，局部角 90°
    expect(normAngle(res.angles.distal)).toBeCloseTo(Math.PI / 2, 9);
    expect(res.clamped).toBe(false);
    expect(res.reach.x).toBeCloseTo(100, 8);
    expect(res.reach.y).toBeCloseTo(100, 8);
  });

  it('双向约束把解夹到边界值，任何输出角度都落在限制内', () => {
    const doc = createDoc();
    const [p, d] = Object.keys(doc.bones);
    const targets = [
      { x: -150, y: 20 },
      { x: 150, y: -120 },
      { x: 0, y: 5 },
      { x: 300, y: 300 },
    ];
    for (const target of targets) {
      const res = solveTwoBoneIK({
        pivot: { x: 0, y: 0 },
        parentWorldAngle: 0,
        l1: 100,
        l2: 80,
        target,
        proximal: { ...doc.bones[p], limit: { min: rad(-20), max: rad(40) } },
        distal: { ...doc.bones[d], limit: { min: rad(-70), max: rad(70) } },
        currentProximal: 0,
        currentDistal: 0,
      });
      expect(res.angles.proximal).toBeGreaterThanOrEqual(rad(-20) - 1e-9);
      expect(res.angles.proximal).toBeLessThanOrEqual(rad(40) + 1e-9);
      expect(res.angles.distal).toBeGreaterThanOrEqual(rad(-70) - 1e-9);
      expect(res.angles.distal).toBeLessThanOrEqual(rad(70) + 1e-9);
    }
  });

  it('applyIKToLocal 写回的角度经 FK 复算后遵守约束', () => {
    let doc = createDoc();
    const [p, d] = Object.keys(doc.bones);
    doc = setLimit(doc, p, { min: rad(-10), max: rad(10) });
    doc = setLimit(doc, d, { min: rad(-30), max: rad(30) });
    const local = { angles: { [p]: 0, [d]: 0 }, lengths: { [p]: 100, [d]: 80 } };
    const pose = poseAt(doc, 0);
    const r = applyIKToLocal(doc, local, d, { x: -200, y: -200 }, pose)!;
    expect(r).not.toBeNull();
    expect(local.angles[p]).toBeGreaterThanOrEqual(rad(-10) - 1e-9);
    expect(local.angles[p]).toBeLessThanOrEqual(rad(10) + 1e-9);
    expect(local.angles[d]).toBeGreaterThanOrEqual(rad(-30) - 1e-9);
    expect(local.angles[d]).toBeLessThanOrEqual(rad(30) + 1e-9);
  });
});

describe('结构编辑合法性', () => {
  it('禁止把骨骼挂到自身或子孙（环）', () => {
    let doc = createDoc();
    const [a, b] = Object.keys(doc.bones);
    doc = addBone(doc, b);
    const c = Object.keys(doc.bones).find((id) => id !== a && id !== b)!;
    expect(() => setParent(doc, b, b)).toThrow(/不存在|环|自身/);
    expect(() => setParent(doc, a, b)).toThrow(); // 根不能改父级
    // b -> c 会成环（c 是 b 的孩子）
    expect(() => setParent(doc, b, c)).toThrow(/环/);
    // 合法重挂：c 改挂到 a
    expect(() => setParent(doc, c, a)).not.toThrow();
  });

  it('删除骨骼后不允许留下引用它的关键帧，子骨转挂祖父', () => {
    let doc = createDoc();
    const [a, b] = Object.keys(doc.bones);
    doc = addBone(doc, b);
    const c = Object.keys(doc.bones).find((id) => id !== a && id !== b)!;
    doc = upsertFrame(doc, b, { t: 0, angle: 0.5 });
    doc = upsertFrame(doc, c, { t: 0, angle: 0.2 });
    doc = deleteBone(doc, b);
    expect(doc.bones[b]).toBeUndefined();
    expect(doc.frames[b]).toBeUndefined();
    expect(doc.bones[c].parentId).toBe(a);
    expect(validateDoc(doc)).toBeNull();
  });

  it('validateDoc 能识别悬空帧引用', () => {
    const doc = createDoc();
    const ghost = 'ghost';
    doc.frames[ghost] = [{ t: 0, angle: 0 }];
    expect(validateDoc(doc)).toMatch(/已删除/);
  });
});
