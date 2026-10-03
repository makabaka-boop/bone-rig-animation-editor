import { useMemo } from 'react';
import { useStore, useSnapshot } from '../state/storeContext';
import { addBone, deleteBone, setParent } from '../core/doc';
import { childrenOf } from '../core/fk';
import { MAX_BONES, MIN_BONES } from '../core/types';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onError: (msg: string) => void;
}

export function StructurePanel({ selectedId, onSelect, onError }: Props) {
  const store = useStore();
  const { doc } = useSnapshot();
  const children = useMemo(() => childrenOf(doc), [doc]);

  const tryRun = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const renderTree = (id: string, depth: number) => {
    const b = doc.bones[id];
    const isSel = id === selectedId;
    return (
      <div key={id}>
        <div
          className={`bone-row${isSel ? ' selected' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => onSelect(id)}
        >
          <span className="name">{b.name}</span>
          {b.parentId === null && <span className="root-tag">根</span>}
        </div>
        {isSel && (
          <div style={{ paddingLeft: 6 + depth * 14, marginBottom: 6 }}>
            {b.parentId !== null && (
              <div className="field">
                <label>父级</label>
                <select
                  value={b.parentId}
                  onChange={(e) => tryRun(() => store.commit(setParent(store.currentDoc, id, e.target.value), '修改父级'))}
                >
                  <option value={b.parentId}>{doc.bones[b.parentId].name}（当前）</option>
                  {Object.values(doc.bones)
                    .filter((x) => x.id !== id && x.id !== b.parentId)
                    // 排除自身子孙：挂到它们下面会成环，故不提供该选项。
                    .filter((x) => {
                      const stack = [...children[id]];
                      while (stack.length) {
                        const cur = stack.pop()!;
                        if (cur === x.id) return false;
                        stack.push(...children[cur]);
                      }
                      return true;
                    })
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="row-actions">
              <button
                disabled={Object.keys(doc.bones).length >= MAX_BONES}
                onClick={() => tryRun(() => store.commit(addBone(store.currentDoc, id), '追加骨骼'))}
              >
                + 子骨
              </button>
              {b.parentId !== null && (
                <button
                  className="danger"
                  disabled={Object.keys(doc.bones).length <= MIN_BONES}
                  onClick={() => {
                    tryRun(() => store.commit(deleteBone(store.currentDoc, id), '删除骨骼'));
                  }}
                >
                  删除
                </button>
              )}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {Object.keys(doc.bones).length}/{MAX_BONES} 根骨骼（最少 {MIN_BONES}）
            </div>
          </div>
        )}
        {children[id].map((cid) => renderTree(cid, depth + 1))}
      </div>
    );
  };

  return (
    <div className="panel left">
      <div className="section-title">骨骼层级</div>
      <div className="bone-tree">{renderTree(doc.rootId, 0)}</div>
      <div className="section-title">说明</div>
      <div className="muted">
        所有骨骼构成单根父子树；把骨骼挂到自身子孙会形成环，操作将被拒绝。删除骨骼时其子骨转挂到祖父级，
        该骨骼的关键帧一并清除。
      </div>
    </div>
  );
}
