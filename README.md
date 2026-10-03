# 二维骨骼动画编辑器（React + Canvas + TypeScript）

2～15 根骨骼的二维关键帧动画编辑器。骨骼构成**单根父子树**；关键帧保存每根骨的
**局部角度与长度**，播放时先在时间轴上插值、再从根累加求全局姿态；拖动末端控制点时
对**两节骨链**执行逆向定位（IK），目标超出可达距离时末端贴在可达包络边界，并始终遵守
各关节角度限制。

## 运行

```bash
npm install
npm run dev       # 开发服务器
npm test          # Vitest 单元测试（22 项）
npm run build     # 类型检查 + 生产构建
```

## 需求与实现对照

| 需求 | 实现 |
| --- | --- |
| 2～15 根骨骼、单根父子树 | `core/doc.ts` 的 `validateDoc`：数量、单根、连通性、父引用全部校验 |
| 不能形成环 | `setParent` 用 `isDescendant` 拒绝挂到自身/子孙；UI 直接不提供该选项 |
| 不能留下引用已删除骨骼的帧 | `deleteBone` 同步删除该骨帧表，子骨转挂祖父；校验器兜底拒绝悬空帧 |
| 关键帧保存局部角度和长度 | `types.Keyframe`；`sampleDoc` 做时间插值（角度走最短弧） |
| 插值后求全局姿态 | `fk.ts`：`sampleDoc -> computeWorldPose`，世界角 = 祖先局部角累加 |
| 两节骨链 IK | `ik.ts` `solveTwoBoneIK`：余弦定理双肘解 + CCD 受限精修 |
| 超出可达距离贴边界 | d 夹到 `[|l1-l2|, l1+l2]`；约束导致够不到时取约束边界最近点 |
| 关节角度限制 | 每步角度夹回 `[min,max]`（含跨 ±π 约束），输出保证合法 |
| 结构/姿态统一可撤销 | `core/history.ts` 单一栈；`RevisionStore.commit/undo/redo`，支持拖动合并 |
| 播放/数值检查/导出同一快照 | `useSnapshot()`（`useSyncExternalStore`）与 `exportJSON()` 均读当前修订 |
| 迟到计算不覆盖新修订 | `schedule(rev, …, localSeq)` 双重作废：修订号 + 拖动单调序号 |

## 目录结构

```
src/
  core/            纯逻辑，无 DOM，可独立测试
    types.ts       数据类型
    geometry.ts    向量/角度/屏幕坐标（y 翻转）
    fk.ts          关键帧采样 + 局部->全局 FK
    ik.ts          两节骨解析 IK + CCD 约束精修
    doc.ts         结构/帧/约束编辑与结构校验
    history.ts     统一撤销栈（支持 coalesce 合并拖动）
    store.ts       修订快照中心 + 异步过期防护
    *.test.ts      坐标变换 / 不可达目标 / 约束边界 / 撤销重播
  state/           React 与 RevisionStore 的桥接
  ui/              Canvas、结构面板、检查器（含单帧数值检查）、时间轴、导出
```

## 操作说明

- **结构**：左栏选中骨骼后可追加子骨、删除（子骨自动转挂祖父）、在下拉框改父级。
- **约束**：右栏拖动 min/max 角度滑条；可一键解除或锁定关节。
- **关键帧**：在时间轴上点击定位时刻，右栏「插入关键帧」；IK 拖动抬手时也会自动落帧。
- **IK**：直接拖动画面末端的绿色控制点；不可达时右上角提示「已贴到边界」。
- **播放/导出**：顶栏播放、撤销/重做、改时长、导出当前修订 JSON（含 revision 号）。
