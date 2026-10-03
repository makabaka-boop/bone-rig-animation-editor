import { MAX_BONES, MIN_BONES } from './types';
import type { Bone, Doc, JointLimit, Keyframe, Vec2 } from './types';
import { childrenOf } from './fk';
import { clamp, normAngle } from './geometry';

let seq = 0;
export function genId(prefix = 'bone'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** 完整结构校验：单根、连通、无环、父引用有效、帧数组成员有效、限制合法。 */
export function validateDoc(doc: Doc): string | null {
  const ids = Object.keys(doc.bones);
  if (ids.length < MIN_BONES || ids.length > MAX_BONES) {
    return `骨骼数量必须在 ${MIN_BONES}~${MAX_BONES} 之间（当前 ${ids.length}）`;
  }
  if (!doc.bones[doc.rootId]) return '根骨骼不存在';

  for (const id of ids) {
    const b = doc.bones[id];
    if (b.id !== id) return `骨骼 id 不一致: ${id}`;
    if (!(b.length > 0)) return `骨骼 ${b.name} 长度必须为正`;
    if (!(b.limit.min <= b.limit.max)) return `骨骼 ${b.name} 角度约束无效（min > max）`;
    if (b.parentId !== null) {
      if (!doc.bones[b.parentId]) return `骨骼 ${b.name} 引用了不存在的父级`;
    }
    if (doc.frames[id] === undefined) return `骨骼 ${b.name} 缺少关键帧表`;
    for (const f of doc.frames[id]) {
      if (f.length !== undefined && !(f.length > 0)) return `骨骼 ${b.name} 存在非正长度关键帧`;
    }
  }
  // 不允许任何帧引用已删除骨骼
  for (const id of Object.keys(doc.frames)) {
    if (!doc.bones[id]) return `存在引用已删除骨骼 ${id} 的关键帧`;
  }
  // 从根可达性遍历：能走到全部节点即连通且无环之外的结构问题；
  // 再单独检测是否存在环。
  const children = childrenOf(doc);
  const seen = new Set<string>();
  const stack = [doc.rootId];
  const active = new Set<string>();
  const visit = (id: string): string | null => {
    if (active.has(id)) return `父子关系在 ${id} 处形成环`;
    if (seen.has(id)) return null;
    seen.add(id);
    active.add(id);
    for (const c of children[id]) {
      const err = visit(c);
      if (err) return err;
    }
    active.delete(id);
    return null;
  };
  const err = visit(doc.rootId);
  if (err) return err;
  if (seen.size !== ids.length) return '存在不属于根树的骨骼（多根或断连）';
  const roots = ids.filter((id) => doc.bones[id].parentId === null);
  if (roots.length !== 1 || roots[0] !== doc.rootId) return '必须恰好存在一个根';
  if (!(doc.duration > 0)) return '动画时长必须为正';
  return null;
}

/** candidate 是否位于 boneId 的子树中（含自身）。用于阻止形成环。 */
export function isDescendant(doc: Doc, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) return true;
  const children = childrenOf(doc);
  const stack = [...(children[ancestorId] ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === candidateId) return true;
    stack.push(...(children[id] ?? []));
  }
  return false;
}

export function createDoc(): Doc {
  const a = genId();
  const b = genId();
  const bones: Record<string, Bone> = {
    [a]: { id: a, name: '根骨', parentId: null, length: 120, limit: { min: -Math.PI, max: Math.PI } },
    [b]: { id: b, name: '骨 2', parentId: a, length: 100, limit: { min: -Math.PI, max: Math.PI } },
  };
  const doc: Doc = {
    rootId: a,
    bones,
    frames: { [a]: [], [b]: [] },
    duration: 2,
  };
  return doc;
}

function clone(doc: Doc): Doc {
  return {
    rootId: doc.rootId,
    duration: doc.duration,
    bones: Object.fromEntries(Object.entries(doc.bones).map(([id, b]) => [id, { ...b, limit: { ...b.limit } }])),
    frames: Object.fromEntries(Object.entries(doc.frames).map(([id, fs]) => [id, fs.map((f) => ({ ...f }))])),
  };
}

/** 追加一根骨骼。 */
export function addBone(doc: Doc, parentId: string, length = 90, name?: string): Doc {
  if (Object.keys(doc.bones).length >= MAX_BONES) {
    throw new Error(`最多只能有 ${MAX_BONES} 根骨骼`);
  }
  if (!doc.bones[parentId]) throw new Error('父级骨骼不存在');
  const next = clone(doc);
  const id = genId();
  const n = Object.keys(doc.bones).length + 1;
  next.bones[id] = {
    id,
    name: name ?? `骨 ${n}`,
    parentId,
    length,
    limit: { min: -Math.PI, max: Math.PI },
  };
  next.frames[id] = [];
  assertValid(next);
  return next;
}

/**
 * 删除骨骼：子骨重新挂到它的父级；同时删除它自身的关键帧，
 * 保证不存在引用已删除骨骼的帧。根骨不可删除；至少保留 MIN_BONES 根。
 */
export function deleteBone(doc: Doc, id: string): Doc {
  if (id === doc.rootId) throw new Error('根骨骼不可删除');
  if (Object.keys(doc.bones).length <= MIN_BONES) {
    throw new Error(`至少保留 ${MIN_BONES} 根骨骼`);
  }
  const bone = doc.bones[id];
  if (!bone) throw new Error('骨骼不存在');
  const next = clone(doc);
  for (const b of Object.values(next.bones)) {
    if (b.parentId === id) b.parentId = bone.parentId;
  }
  delete next.bones[id];
  delete next.frames[id];
  assertValid(next);
  return next;
}

/**
 * 修改父级关系。
 * - 根不能被重新挂接；
 * - 不能把骨骼挂到自己或自己的子孙下面（否则成环）；
 * - newParent 必须存在。
 */
export function setParent(doc: Doc, id: string, newParentId: string | null): Doc {
  if (id === doc.rootId) throw new Error('根骨骼不能修改父级');
  if (newParentId === null) throw new Error('非根骨骼必须有父级');
  if (!doc.bones[newParentId]) throw new Error('新父级不存在');
  if (newParentId === doc.bones[id].parentId) return doc;
  if (isDescendant(doc, id, newParentId)) {
    throw new Error('不能把骨骼挂到自身或其子级下面（会形成环）');
  }
  const next = clone(doc);
  next.bones[id].parentId = newParentId;
  assertValid(next);
  return next;
}

export function renameBone(doc: Doc, id: string, name: string): Doc {
  if (!doc.bones[id]) throw new Error('骨骼不存在');
  const next = clone(doc);
  next.bones[id].name = name;
  return next;
}

export function setBoneLength(doc: Doc, id: string, length: number): Doc {
  if (!(length > 0)) throw new Error('长度必须为正');
  const next = clone(doc);
  next.bones[id].length = length;
  assertValid(next);
  return next;
}

export function setLimit(doc: Doc, id: string, limit: JointLimit): Doc {
  // 约束跨度不超过一整圈，并把角度规整到 (-pi, pi]
  const min = normAngle(limit.min);
  let max = normAngle(limit.max);
  if (max < min) max += Math.PI * 2;
  if (max - min > Math.PI * 2) throw new Error('约束范围不能超过 360°');
  const next = clone(doc);
  next.bones[id].limit = { min, max };
  return next;
}

export function setDuration(doc: Doc, duration: number): Doc {
  if (!(duration > 0)) throw new Error('时长必须为正');
  const next = clone(doc);
  next.duration = duration;
  for (const id of Object.keys(next.frames)) {
    next.frames[id] = next.frames[id].filter((f) => f.t <= duration);
  }
  return next;
}

/** 插入或替换某骨骼在时刻 t 的关键帧（按 t 升序）。 */
export function upsertFrame(doc: Doc, boneId: string, frame: Keyframe): Doc {
  if (!doc.bones[boneId]) throw new Error('骨骼不存在');
  if (frame.t < 0 || frame.t > doc.duration) throw new Error('关键帧时间超出动画范围');
  if (frame.length !== undefined && !(frame.length > 0)) throw new Error('长度必须为正');
  const next = clone(doc);
  const list = next.frames[boneId];
  const idx = list.findIndex((f) => Math.abs(f.t - frame.t) < 1e-6);
  const norm: Keyframe = { ...frame, angle: normAngle(frame.angle) };
  if (idx >= 0) list[idx] = norm;
  else {
    list.push(norm);
    list.sort((a, b) => a.t - b.t);
  }
  return next;
}

export function deleteFrame(doc: Doc, boneId: string, t: number): Doc {
  const next = clone(doc);
  next.frames[boneId] = next.frames[boneId].filter((f) => Math.abs(f.t - t) >= 1e-6);
  return next;
}

/**
 * 把一次 IK/姿态编辑的结果（若干骨骼的局部角）烘焙为关键帧。
 * 多根骨骼的写入合并为单个文档修订（一次撤销即可回退）。
 */
export function bakeAngles(
  doc: Doc,
  t: number,
  angles: Record<string, number>,
  lengths?: Record<string, number>,
): Doc {
  let next = doc;
  for (const [id, angle] of Object.entries(angles)) {
    next = upsertFrame(next, id, {
      t,
      angle,
      length: lengths?.[id] ?? next.frames[id].find((f) => Math.abs(f.t - t) < 1e-6)?.length,
    });
  }
  return next === doc ? doc : next;
}

/** 把局部角度限制进各骨约束。 */
export function clampAnglesToLimits(doc: Doc, angles: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, a] of Object.entries(angles)) {
    const b = doc.bones[id];
    out[id] = b ? clamp(normAngle(a), b.limit.min, b.limit.max) : a;
  }
  return out;
}

export function rootPosition(_doc: Doc): Vec2 {
  return { x: 0, y: 0 };
}

function assertValid(doc: Doc): void {
  const err = validateDoc(doc);
  if (err) throw new Error(err);
}
