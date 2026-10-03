import { describe, expect, it } from 'vitest';
import { RevisionStore } from './store';
import { createDoc, bakeAngles, addBone, setLimit } from './doc';
import { poseAt } from './fk';

describe('撤销后的重播', () => {
  it('撤销结构与姿态编辑后，播放采样回到旧修订的姿态', () => {
    const store = new RevisionStore(createDoc());
    const [a, b] = Object.keys(store.currentDoc.bones);

    // 修订 1：给子骨打一个 90° 关键帧
    const doc1 = bakeAngles(store.currentDoc, 0, { [b]: Math.PI / 2 });
    store.commit(doc1, '旋转骨2');
    const pose1 = poseAt(store.currentDoc, 0);
    expect(pose1.bones[b].worldAngle).toBeCloseTo(Math.PI / 2, 9);

    // 修订 2：再加一根骨（结构编辑，同一历史）
    const doc2 = addBone(store.currentDoc, b, 70, '骨3');
    store.commit(doc2, '追加骨骼');
    expect(Object.keys(store.currentDoc.bones)).toHaveLength(3);

    // 撤销结构添加
    store.undo();
    expect(Object.keys(store.currentDoc.bones)).toHaveLength(2);
    // 撤销姿态编辑
    store.undo();
    const poseAfterUndo = poseAt(store.currentDoc, 0);
    expect(poseAfterUndo.bones[b].worldAngle).toBeCloseTo(0, 9);
    expect(poseAfterUndo.bones[b].end.y).toBeCloseTo(0, 9);
    expect(poseAfterUndo.bones[b].end.x).toBeCloseTo(120 + 100, 9); // 默认长度 120 + 100

    // 重做恢复
    store.redo();
    expect(poseAt(store.currentDoc, 0).bones[b].worldAngle).toBeCloseTo(Math.PI / 2, 9);
    store.redo();
    expect(Object.keys(store.currentDoc.bones)).toHaveLength(3);
  });

  it('拖动期间的连续提交合并为一条历史', () => {
    const store = new RevisionStore(createDoc());
    const [, b] = Object.keys(store.currentDoc.bones);
    for (let i = 1; i <= 10; i++) {
      store.commit(bakeAngles(store.currentDoc, 0, { [b]: i / 20 }), 'IK 拖动', 'ik-drag');
    }
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(poseAt(store.currentDoc, 0).bones[b].worldAngle).toBeCloseTo(0, 9);
  });

  it('迟到的异步计算结果不能覆盖新修订', async () => {
    const store = new RevisionStore(createDoc());
    const [, b] = Object.keys(store.currentDoc.bones);
    const revAtDragStart = store.getSnapshot().rev;

    // 模拟一次耗时的 IK 求解
    const pending = store.schedule(revAtDragStart, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { angle: 1.23 };
    });

    // 用户在求解返回前做了新的编辑（修订号前移）
    store.commit(bakeAngles(store.currentDoc, 0, { [b]: 0.5 }), '新的姿态编辑');
    const newerRev = store.getSnapshot().rev;

    const token = await pending;
    expect(token).toBeNull(); // 迟到结果作废
    const committed = store.commitIfCurrent(token, (doc, v) => bakeAngles(doc, 0, { [b]: v.angle }), '过期 IK');
    expect(committed).toBe(false);
    expect(store.getSnapshot().rev).toBe(newerRev);
    expect(poseAt(store.currentDoc, 0).bones[b].worldAngle).toBeCloseTo(0.5, 9);
  });

  it('撤销本身也会使在途异步结果失效', async () => {
    const store = new RevisionStore(createDoc());
    const [, b] = Object.keys(store.currentDoc.bones);
    store.commit(bakeAngles(store.currentDoc, 0, { [b]: 0.7 }), '编辑');
    const rev = store.getSnapshot().rev;
    const pending = store.schedule(rev, () => ({ angle: 2.2 }));
    store.undo();
    const token = await pending;
    expect(token).toBeNull();
  });

  it('同一修订内连续发起的计算，调用方可凭 localSeq 丢弃迟到结果', async () => {
    const store = new RevisionStore(createDoc());
    const rev = store.getSnapshot().rev;

    const slow = store.schedule(
      rev,
      () => new Promise((r) => setTimeout(r, 30)).then(() => 'old-target'),
      1,
    );
    const fast = store.schedule(
      rev,
      () => new Promise((r) => setTimeout(r, 5)).then(() => 'new-target'),
      2,
    );

    let latestSeq = 1;
    const [tokOld, tokNew] = await Promise.all([slow, fast]);
    // 两者 store 修订都有效（修订号未变）
    expect(tokOld).not.toBeNull();
    expect(tokNew).not.toBeNull();
    latestSeq = Math.max(latestSeq, tokNew!.localSeq);
    // 关键：慢结果回来时其 localSeq 落后于最新序号，调用方必须拒绝它。
    expect(tokOld!.localSeq).toBeLessThan(latestSeq);
    const accepted = tokOld!.localSeq === latestSeq;
    expect(accepted).toBe(false);
  });

  it('导出的内容就是当前修订快照', () => {
    const store = new RevisionStore(createDoc());
    const [, b] = Object.keys(store.currentDoc.bones);
    store.commit(setLimit(store.currentDoc, b, { min: -0.5, max: 0.5 }), '约束编辑');
    const exported = JSON.parse(store.exportJSON());
    expect(exported.doc.bones[b].limit.max).toBeCloseTo(0.5, 9);
    expect(exported.revision).toBe(store.getSnapshot().rev);
  });
});
