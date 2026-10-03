import type { Bone, Doc, Keyframe, SkeletonPose, Vec2 } from './types';
import { add, lerp, lerpAngle, scale, TAU, v } from './geometry';

/** 静息（或某时刻）每根骨的局部角度与长度。 */
export interface LocalPose {
  angles: Record<string, number>;
  lengths: Record<string, number>;
}

export function childrenOf(doc: Doc): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of Object.keys(doc.bones)) out[id] = [];
  for (const bone of Object.values(doc.bones)) {
    if (bone.parentId) out[bone.parentId].push(bone.id);
  }
  for (const id of Object.keys(out)) out[id].sort();
  return out;
}

/** 静息姿态：角度 0、使用骨骼静态长度。 */
export function restPose(doc: Doc): LocalPose {
  const angles: Record<string, number> = {};
  const lengths: Record<string, number> = {};
  for (const [id, b] of Object.entries(doc.bones)) {
    angles[id] = 0;
    lengths[id] = b.length;
  }
  return { angles, lengths };
}

/** 关键帧阶梯插值：t 之前为最近一帧，之后线性插值；末帧之后保持。 */
function sampleFrames(frames: Keyframe[] | undefined, t: number, defAngle: number, defLength: number)
  : { angle: number; length: number } {
  if (!frames || frames.length === 0) return { angle: defAngle, length: defLength };
  if (t <= frames[0].t) {
    const f = frames[0];
    return { angle: f.angle, length: f.length ?? defLength };
  }
  const last = frames[frames.length - 1];
  if (t >= last.t) return { angle: last.angle, length: last.length ?? defLength };
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t || 1);
      return {
        angle: lerpAngle(a.angle, b.angle, u),
        length: lerp(a.length ?? defLength, b.length ?? defLength, u),
      };
    }
  }
  return { angle: defAngle, length: defLength };
}

/** 对文档在时刻 t 采样，得到每根骨的局部角度/长度。 */
export function sampleDoc(doc: Doc, t: number): LocalPose {
  const angles: Record<string, number> = {};
  const lengths: Record<string, number> = {};
  const tt = Math.max(0, Math.min(t, doc.duration));
  for (const [id, bone] of Object.entries(doc.bones)) {
    const s = sampleFrames(doc.frames[id], tt, 0, bone.length);
    angles[id] = s.angle;
    lengths[id] = s.length;
  }
  return { angles, lengths };
}

/**
 * 局部姿态 -> 全局姿态。
 * 从根开始沿父子树累加角度：worldAngle(child) = worldAngle(parent) + localAngle(child)。
 * 树根固定在世界原点。
 */
export function computeWorldPose(doc: Doc, local: LocalPose, origin: Vec2 = v(0, 0)): SkeletonPose {
  const children = childrenOf(doc);
  const bones: SkeletonPose['bones'] = {};

  const visit = (boneId: string, parentEnd: Vec2, parentWorld: number) => {
    const bone: Bone = doc.bones[boneId];
    const localAngle = local.angles[boneId] ?? 0;
    const length = local.lengths[boneId] ?? bone.length;
    const worldAngle = parentWorld + localAngle;
    const start = parentEnd;
    const end = add(start, scale({ x: Math.cos(worldAngle), y: Math.sin(worldAngle) }, length));
    bones[boneId] = { boneId, start, end, localAngle, worldAngle, length };
    for (const cid of children[boneId]) visit(cid, end, worldAngle);
  };
  visit(doc.rootId, origin, 0);
  return { t: 0, bones };
}

/** 便捷封装：在时刻 t 求全局姿态。 */
export function poseAt(doc: Doc, t: number, origin: Vec2 = v(0, 0)): SkeletonPose {
  const local = sampleDoc(doc, t);
  const pose = computeWorldPose(doc, local, origin);
  pose.t = t;
  return pose;
}

export { TAU };
