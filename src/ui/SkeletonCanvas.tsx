import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore, useSnapshot } from '../state/storeContext';
import { bakeAngles } from '../core/doc';
import { poseAt, sampleDoc, computeWorldPose } from '../core/fk';
import type { LocalPose } from '../core/fk';
import { applyIKToLocal } from '../core/ik';
import { screenToWorld, worldToScreen } from '../core/geometry';
import type { SkeletonPose, Vec2 } from '../core/types';

interface Props {
  time: number;
  playing: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onTick: (t: number) => void;
}

interface DragState {
  endBoneId: string;
  /** 手势发起时的修订号；期间若外部修订前进（撤销/结构编辑），结果作废。 */
  rev: number;
  token: number;
  /** 最新一次求解（用于重绘）。 */
  solution:
    | {
        pose: SkeletonPose;
        angles: Record<string, number>;
        lengths: Record<string, number>;
        clamped: boolean;
        target: Vec2;
      }
    | null;
}

const HANDLE_R = 7;

export function SkeletonCanvas({ time, playing, selectedId, onSelect, onTick }: Props) {
  const store = useStore();
  const snapshot = useSnapshot();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [, forceRedraw] = useState(0);
  const [ikClamped, setIkClamped] = useState<{ clamped: boolean; visible: boolean }>({
    clamped: false,
    visible: false,
  });

  const dragRef = useRef<DragState | null>(null);
  // 拖动内单调递增的指针序号：晚到的异步结果若序号落后于最新指针，一律丢弃。
  const moveSeqRef = useRef(0);
  const timeRef = useRef(time);
  const playingRef = useRef(playing);
  const selectedRef = useRef(selectedId);
  timeRef.current = time;
  playingRef.current = playing;
  selectedRef.current = selectedId;

  // 播放 rAF 循环：时间推进驱动父组件重渲染（画面仍只读当前修订快照）。
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      if (playingRef.current) {
        const doc = store.currentDoc;
        let t = timeRef.current + dt;
        if (t >= doc.duration) t = t % doc.duration;
        onTick(t);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [store, onTick]);

  // 自适应画布尺寸（devicePixelRatio 锐化）。
  useEffect(() => {
    const el = canvasRef.current!.parentElement!;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const getOrigin = useCallback(
    (): { origin: Vec2; zoom: number } => ({
      origin: { x: size.w / 2, y: size.h / 2 + 80 },
      zoom: Math.min(size.w, size.h) / 520,
    }),
    [size],
  );

  // 对指定文档修订在目标点上求解两节骨 IK（纯函数，不修改状态）。
  const solveAt = useCallback(
    (target: Vec2, endBoneId: string, doc = store.currentDoc, t = timeRef.current) => {
      const local: LocalPose = sampleDoc(doc, t);
      const basePose = computeWorldPose(doc, local);
      const result = applyIKToLocal(doc, local, endBoneId, target, basePose);
      if (!result) return null;
      return {
        result,
        pose: computeWorldPose(doc, local),
        local,
        angles: {
          [result.chain.proximalId]: result.angles.proximal,
          [result.chain.distalId]: result.angles.distal,
        },
      };
    },
    [store],
  );

  // 每帧重绘：播放/空闲严格按修订快照采样；拖动中显示手势内最新求解预览。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const doc = snapshot.doc;
    const drag = dragRef.current;
    // 仅当手势发起修订仍是当前修订时才使用预览（撤销/结构编辑后自动失效）。
    const previewLive = drag && drag.solution && drag.rev === snapshot.rev;
    const pose: SkeletonPose = previewLive && drag.solution
      ? drag.solution.pose
      : poseAt(doc, timeRef.current);

    const { origin, zoom } = getOrigin();
    const toS = (p: Vec2) => worldToScreen(p, origin, zoom);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const grid = 40 * zoom;
    for (let x = origin.x % grid; x < size.w; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.h);
      ctx.stroke();
    }
    for (let y = origin.y % grid; y < size.h; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.stroke();
    }
    // 世界坐标轴（屏幕 y 已翻转，因此世界 +y 向上）
    const axX = toS({ x: 60, y: 0 });
    const axY = toS({ x: 0, y: 60 });
    ctx.strokeStyle = 'rgba(255,180,84,0.5)';
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(axX.x, axX.y);
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(axY.x, axY.y);
    ctx.stroke();

    // 拖动目标十字
    if (previewLive && drag.solution) {
      const t = worldToScreen(drag.solution.target, origin, zoom);
      ctx.strokeStyle = 'rgba(255,180,84,0.7)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(t.x - 8, t.y);
      ctx.lineTo(t.x + 8, t.y);
      ctx.moveTo(t.x, t.y - 8);
      ctx.lineTo(t.x, t.y + 8);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const bp of Object.values(pose.bones)) {
      const s = toS(bp.start);
      const e = toS(bp.end);
      const selected = bp.boneId === selectedRef.current;
      ctx.strokeStyle = selected ? '#5aa2ff' : '#7d8aa1';
      ctx.lineWidth = selected ? 7 : 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();

      const ang = Math.atan2(e.y - s.y, e.x - s.x);
      const mx = (s.x + e.x) / 2;
      const my = (s.y + e.y) / 2;
      ctx.fillStyle = selected ? '#bcd8ff' : '#aab6ca';
      ctx.beginPath();
      ctx.moveTo(mx + 8 * Math.cos(ang), my + 8 * Math.sin(ang));
      ctx.lineTo(mx - 5 * Math.cos(ang - 0.5), my - 5 * Math.sin(ang - 0.5));
      ctx.lineTo(mx - 5 * Math.cos(ang + 0.5), my - 5 * Math.sin(ang + 0.5));
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#1d2128';
      ctx.strokeStyle = selected ? '#5aa2ff' : '#93a0b4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 末端控制点
      ctx.fillStyle = '#3ddc97';
      ctx.strokeStyle = '#0e1014';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, HANDLE_R - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#93a0b4';
      ctx.font = '11px system-ui';
      ctx.fillText(doc.bones[bp.boneId].name, s.x + 8, s.y - 8);
    }
  }, [snapshot, size, getOrigin]);

  const worldFromEvent = (ev: React.MouseEvent): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { origin, zoom } = getOrigin();
    return screenToWorld({ x: ev.clientX - rect.left, y: ev.clientY - rect.top }, origin, zoom);
  };

  const hitHandle = useCallback(
    (ev: React.MouseEvent): string | null => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sp = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      const { origin, zoom } = getOrigin();
      const pose = poseAt(store.currentDoc, timeRef.current);
      let best: { id: string; d: number } | null = null;
      for (const bp of Object.values(pose.bones)) {
        const es = worldToScreen(bp.end, origin, zoom);
        const d = Math.hypot(es.x - sp.x, es.y - sp.y);
        if (d <= HANDLE_R + 4 && (!best || d < best.d)) best = { id: bp.boneId, d };
      }
      return best?.id ?? null;
    },
    [store, getOrigin],
  );

  // 更新瞬态预览（不落文档、不入历史）。
  const updatePreview = (target: Vec2) => {
    const drag = dragRef.current;
    if (!drag) return;
    // 手势期间若修订号已被外部推进，放弃本次手势。
    if (drag.rev !== store.getSnapshot().rev) {
      dragRef.current = null;
      return;
    }
    const solved = solveAt(target, drag.endBoneId);
    if (!solved) return;
    drag.solution = {
      pose: solved.pose,
      angles: solved.angles,
      lengths: solved.local.lengths,
      clamped: solved.result.clamped,
      target,
    };
    setIkClamped({ clamped: solved.result.clamped, visible: true });
    forceRedraw((n) => n + 1);
  };

  // 演示“拖动期间迟到的计算结果”：延迟对某个旧目标求解，
  // 返回时若已有更新的鼠标位置（序号更大），则该结果必须被丢弃，不能回跳。
  const scheduleLateComputation = (target: Vec2) => {
    const drag = dragRef.current;
    if (!drag) return;
    const myToken = ++drag.token;
    const mySeq = ++moveSeqRef.current;
    const revAtSchedule = drag.rev;
    const tAtSchedule = timeRef.current;
    const captured = target;
    void store
      .schedule(revAtSchedule, () => new Promise((r) => setTimeout(r, 80)), mySeq)
      .then((token) => {
        // 手势已结束/被新编辑作废：结果不处理。
        if (dragRef.current !== drag || myToken !== drag.token) return;
        if (!token) return; // 修订过期：store 直接拒绝。
        // 序号防护：拖动期间 store 修订号不变（预览不入库），
        // 只能靠这个单调序号识别“晚到的旧位置”。
        if (token.localSeq !== moveSeqRef.current) return;
        // 模拟“迟到解”：用发起时捕获的旧目标重新求解。
        const solved = solveAt(captured, drag.endBoneId, store.currentDoc, tAtSchedule);
        if (!solved) return;
        const cur = drag.solution;
        const stale =
          !cur || Math.abs(cur.target.x - captured.x) > 1e-9 || Math.abs(cur.target.y - captured.y) > 1e-9;
        if (stale) return; // 双保险：迟到的计算结果不能覆盖新位置。
        drag.solution = {
          pose: solved.pose,
          angles: solved.angles,
          lengths: solved.local.lengths,
          clamped: solved.result.clamped,
          target: captured,
        };
        forceRedraw((n) => n + 1);
      });
  };

  const onMouseDown = (ev: React.MouseEvent) => {
    const id = hitHandle(ev);
    if (id) {
      onSelect(id);
      const target = worldFromEvent(ev);
      dragRef.current = { endBoneId: id, rev: store.getSnapshot().rev, token: 0, solution: null };
      updatePreview(target);
      scheduleLateComputation(target);
      ev.preventDefault();
    } else {
      onSelect(null);
    }
  };

  const onMouseMove = (ev: React.MouseEvent) => {
    if (!dragRef.current) return;
    const target = worldFromEvent(ev);
    updatePreview(target);
    scheduleLateComputation(target);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag && drag.solution && drag.rev === store.getSnapshot().rev) {
      // 抬手：最终角度烘焙为当前时刻关键帧，进入一次可撤销历史。
      store.commit(
        bakeAngles(store.currentDoc, timeRef.current, drag.solution.angles, drag.solution.lengths),
        'IK 落帧',
      );
      setIkClamped({ clamped: drag.solution.clamped, visible: true });
    }
    dragRef.current = null;
    setTimeout(() => setIkClamped((v) => ({ ...v, visible: false })), 800);
  };

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      />
      <div className="canvas-hint">拖动绿色末端控制点执行两节骨 IK（自动遵守角度约束与可达边界）</div>
      {ikClamped.visible && (
        <div className={`ik-badge${ikClamped.clamped ? ' clamped' : ''}`}>
          {ikClamped.clamped ? '目标不可达：末端贴在可达边界' : 'IK 跟随中'}
        </div>
      )}
    </div>
  );
}
