import { useStore, useSnapshot } from '../state/storeContext';
import { setDuration } from '../core/doc';

export function TopBar() {
  const store = useStore();
  const { rev } = useSnapshot();

  const doExport = () => {
    // 导出与画面、数值检查读取的是同一个修订快照。
    const json = store.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skeleton-rev${rev}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="topbar">
      <h1>二维骨骼动画编辑器</h1>
      <button onClick={() => store.undo()} disabled={!store.canUndo}>
        ↶ 撤销
      </button>
      <button onClick={() => store.redo()} disabled={!store.canRedo}>
        ↷ 重做
      </button>
      <span className="muted">时长(s)</span>
      <input
        type="number"
        min={0.1}
        step={0.1}
        style={{ width: 64 }}
        value={store.currentDoc.duration}
        onChange={(e) => {
          const d = Number(e.target.value);
          if (d > 0) store.commit(setDuration(store.currentDoc, d), '修改时长');
        }}
      />
      <button className="primary" onClick={doExport}>
        导出当前修订 JSON
      </button>
      <span className="rev">revision #{rev}</span>
    </div>
  );
}
