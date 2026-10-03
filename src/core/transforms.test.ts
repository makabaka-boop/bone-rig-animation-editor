import { describe, expect, it } from 'vitest';
import { poseAt, computeWorldPose, restPose, sampleDoc } from './fk';
import { createDoc } from './doc';
import type { Doc } from './types';
import { rad, worldToScreen, screenToWorld, lerpAngle, normAngle } from './geometry';

function docWith(angles: Record<string, number>, lengths?: Record<string, number>): Doc {
  const doc = createDoc();
  const [a, b] = Object.keys(doc.bones);
  // 让 a 为根、b 为子（createDoc 已保证），重排长度。
  doc.bones[a].length = 100;
  doc.bones[b].length = 50;
  for (const [id, ang] of Object.entries(angles)) {
    doc.frames[id] = [{ t: 0, angle: ang }];
  }
  if (lengths) {
    for (const [id, l] of Object.entries(lengths)) doc.frames[id]![0]!.length = l;
  }
  return doc;
}

describe('坐标变换 FK', () => {
  it('根骨沿 +x，垂直子骨末端在 (100, 100)', () => {
    const doc = createDoc();
    const [a, b] = Object.keys(doc.bones);
    doc.bones[a].length = 100;
    doc.bones[b].length = 100;
    doc.frames[b] = [{ t: 0, angle: Math.PI / 2 }];

    const pose = poseAt(doc, 0);
    expect(pose.bones[a].start).toEqual({ x: 0, y: 0 });
    expect(pose.bones[a].end).toEqual({ x: 100, y: 0 });
    expect(pose.bones[a].worldAngle).toBeCloseTo(0);
    expect(pose.bones[b].start).toEqual({ x: 100, y: 0 });
    expect(pose.bones[b].end.x).toBeCloseTo(100);
    expect(pose.bones[b].end.y).toBeCloseTo(100);
    expect(pose.bones[b].worldAngle).toBeCloseTo(Math.PI / 2);
  });

  it('世界角 = 各祖先局部角累加（三级链）', () => {
    const doc = createDoc();
    const [a, b] = Object.keys(doc.bones);
    const c = Object.keys(doc.bones)[2] ?? (() => {
      const id = 'c';
      doc.bones[id] = { id, name: 'c', parentId: b, length: 40, limit: { min: -Math.PI, max: Math.PI } };
      doc.frames[id] = [];
      return id;
    })();
    doc.bones[a].length = 100;
    doc.bones[b].length = 50;
    doc.frames[b] = [{ t: 0, angle: rad(30) }];
    doc.frames[c] = [{ t: 0, angle: rad(20) }];

    const pose = poseAt(doc, 0);
    expect(pose.bones[c].worldAngle).toBeCloseTo(rad(50), 10);
    const end = pose.bones[c].end;
    expect(end.x).toBeCloseTo(100 + 50 * Math.cos(rad(30)) + 40 * Math.cos(rad(50)), 9);
    expect(end.y).toBeCloseTo(50 * Math.sin(rad(30)) + 40 * Math.sin(rad(50)), 9);
  });

  it('关键帧之间沿最短弧插值角度和长度', () => {
    const doc = docWith({});
    const [a, b] = Object.keys(doc.bones);
    doc.duration = 2;
    doc.frames[b] = [
      { t: 0, angle: 0, length: 50 },
      { t: 2, angle: rad(90), length: 150 },
    ];
    const mid = sampleDoc(doc, 1);
    expect(mid.angles[b]).toBeCloseTo(Math.PI / 4, 9);
    expect(mid.lengths[b]).toBeCloseTo(100);
    // 末帧之后保持
    const after = sampleDoc(doc, 2);
    expect(after.angles[b]).toBeCloseTo(Math.PI / 2, 9);
    // 最短弧：从 170° 到 -170° 在半程应穿过 180° 而不是走 350° 的大圈
    expect(normAngle(lerpAngle(rad(170), rad(-170), 0.5))).toBeCloseTo(Math.PI, 9);
  });

  it('世界坐标与屏幕坐标互逆（Canvas y 轴向下）', () => {
    const origin = { x: 200, y: 300 };
    const zoom = 2;
    const p = { x: 35, y: -80 };
    const s = worldToScreen(p, origin, zoom);
    expect(s).toEqual({ x: 270, y: 460 });
    const back = screenToWorld(s, origin, zoom);
    expect(back.x).toBeCloseTo(35);
    expect(back.y).toBeCloseTo(-80);
  });

  it('静息姿态全部局部角为 0、沿 x 轴排开', () => {
    const doc = docWith({});
    const pose = computeWorldPose(doc, restPose(doc));
    for (const bp of Object.values(pose.bones)) {
      expect(bp.worldAngle).toBeCloseTo(0);
      expect(bp.end.y).toBeCloseTo(0);
    }
  });
});
