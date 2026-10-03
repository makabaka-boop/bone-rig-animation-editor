import type { Doc } from './types';

export interface HistoryEntry {
  doc: Doc;
  label: string;
  /** 连续相同 coalesceKey 的提交会合并为同一条历史（如拖动过程）。 */
  coalesceKey?: string;
  rev: number;
}

/**
 * 结构编辑与姿态编辑共用同一栈 —— 任何产生新 Doc 的操作
 * 都经由 push 进入，撤销时按统一顺序回退。
 */
export class History {
  private stack: HistoryEntry[] = [];
  private index = -1;

  constructor(initial: Doc, label = '初始状态') {
    this.stack = [{ doc: initial, label, rev: 0 }];
    this.index = 0;
  }

  get current(): HistoryEntry {
    return this.stack[this.index];
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /** 推入一条修订；redo 支线在新提交时被截断。 */
  push(doc: Doc, rev: number, label: string, coalesceKey?: string): HistoryEntry {
    const top = this.stack[this.index];
    if (coalesceKey && top.coalesceKey === coalesceKey) {
      // 合并：替换当前条目内容，但保留首次的标签与修订位置。
      this.stack[this.index] = { ...top, doc, rev };
      return this.stack[this.index];
    }
    this.stack = this.stack.slice(0, this.index + 1);
    const entry: HistoryEntry = { doc, label, coalesceKey, rev };
    this.stack.push(entry);
    this.index += 1;
    return entry;
  }

  undo(): HistoryEntry {
    if (!this.canUndo) return this.current;
    this.index -= 1;
    return this.current;
  }

  redo(): HistoryEntry {
    if (!this.canRedo) return this.current;
    this.index += 1;
    return this.current;
  }

  labels(): { label: string; active: boolean }[] {
    return this.stack.map((e, i) => ({ label: e.label, active: i === this.index }));
  }
}
