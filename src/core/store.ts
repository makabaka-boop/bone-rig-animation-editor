import type { Doc } from './types';
import { History } from './history';
import { validateDoc } from './doc';

export interface Snapshot {
  doc: Doc;
  /** 单调递增修订号；任何提交（含撤销/重做）都会 +1。 */
  rev: number;
}

type Listener = (snap: Snapshot) => void;

/**
 * 修订快照中心。播放画面、单帧数值检查、导出全部读取这里的同一快照，
 * 不会各自持有文档副本。
 *
 * 异步计算（拖动 IK 的延迟求解等）必须携带发起时的修订号；
 * 提交结果时若修订号已过期（用户又改了结构/约束/帧或撤销），
 * 结果直接丢弃，迟到的计算不能覆盖新修订。
 */
export class RevisionStore {
  private history: History;
  private rev = 0;
  private listeners = new Set<Listener>();

  constructor(initial: Doc) {
    const err = validateDoc(initial);
    if (err) throw new Error(`初始文档非法: ${err}`);
    this.history = new History(initial);
  }

  getSnapshot(): Snapshot {
    return { doc: this.history.current.doc, rev: this.rev };
  }

  get currentDoc(): Doc {
    return this.history.current.doc;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 提交一个新文档修订。 */
  commit(next: Doc, label: string, coalesceKey?: string): Snapshot {
    const err = validateDoc(next);
    if (err) throw new Error(`拒绝提交非法文档: ${err}`);
    this.rev += 1;
    this.history.push(next, this.rev, label, coalesceKey);
    this.emit();
    return this.getSnapshot();
  }

  undo(): Snapshot {
    if (!this.history.canUndo) return this.getSnapshot();
    this.history.undo();
    // 撤销同样产生新修订号，使撤销前发出的异步结果失效。
    this.rev += 1;
    this.emit();
    return this.getSnapshot();
  }

  redo(): Snapshot {
    if (!this.history.canRedo) return this.getSnapshot();
    this.history.redo();
    this.rev += 1;
    this.emit();
    return this.getSnapshot();
  }

  get canUndo() {
    return this.history.canUndo;
  }

  get canRedo() {
    return this.history.canRedo;
  }

  historyLabels() {
    return this.history.labels();
  }

  private emit() {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) fn(snap);
  }

  /**
   * 发起一个可能迟到的异步计算。
   *
   * @param rev      发起时的 store 修订号（结构/撤销等会使其失效）
   * @param localSeq 调用方自定义的单调序号（如拖动中的指针位置序号）；
   *                 resolve 后会原样回传，供调用方比对自己的最新序号。
   * @returns null 表示 store 修订已过期，调用方必须忽略结果。
   */
  async schedule<T>(
    rev: number,
    compute: () => Promise<T> | T,
    localSeq = 0,
  ): Promise<{ rev: number; value: T; localSeq: number } | null> {
    const value = await compute();
    if (rev !== this.rev) return null;
    return { rev, value, localSeq };
  }

  /** 仅当修订号仍然最新时才提交（双保险：compute 之后到提交之间也可能发生修改）。 */
  commitIfCurrent<T>(token: { rev: number; value: T } | null, build: (doc: Doc, value: T) => Doc, label: string, coalesceKey?: string): boolean {
    if (!token || token.rev !== this.rev) return false;
    const next = build(this.currentDoc, token.value);
    this.commit(next, label, coalesceKey);
    return true;
  }

  /** 导出始终序列化当前修订快照。 */
  exportJSON(): string {
    return JSON.stringify({ version: 1, revision: this.rev, doc: this.currentDoc }, null, 2);
  }
}
