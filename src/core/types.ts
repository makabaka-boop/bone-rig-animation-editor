// 二维骨骼动画编辑器的核心数据类型。

export interface Vec2 {
  x: number;
  y: number;
}

/** 关节角度约束（局部角度，弧度）。min <= max */
export interface JointLimit {
  min: number;
  max: number;
}

/** 静态骨骼定义，构成一棵以 rootId 为根的父子树。 */
export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  length: number;
  limit: JointLimit;
}

/** 关键帧：保存局部角度（长度可在同一时间点逐骨覆盖静息长度）。 */
export interface Keyframe {
  t: number;
  angle: number;
  length?: number;
}

/** 可撤销文档：结构 + 约束 + 关键帧。 */
export interface Doc {
  rootId: string;
  bones: Record<string, Bone>;
  /** 骨骼 id -> 按时间升序排列的关键帧。 */
  frames: Record<string, Keyframe[]>;
  /** 动画总时长（秒）。 */
  duration: number;
}

/** FK 计算出的单骨全局姿态。 */
export interface BonePose {
  boneId: string;
  /** 世界系下的关节起点。 */
  start: Vec2;
  /** 世界系下的末端。 */
  end: Vec2;
  /** 静息局部角度（弧度，+x 为 0，逆时针为正，y 轴向上）。 */
  localAngle: number;
  /** 世界绝对角度。 */
  worldAngle: number;
  length: number;
}

/** 一次采样/播放时刻的完整姿态。 */
export interface SkeletonPose {
  t: number;
  bones: Record<string, BonePose>;
}

export const MIN_BONES = 2;
export const MAX_BONES = 15;
