import { useMemo } from 'react';
import { useStore, useSnapshot } from '../state/storeContext';
import { renameBone, setBoneLength, setLimit, upsertFrame, deleteFrame } from '../core/doc';
import { poseAt, sampleDoc } from '../core/fk';
import { deg, rad } from '../core/geometry';

interface Props {
  selectedId: string | null;
  time: number;
}

export function InspectorPanel({ selectedId, time }: Props) {
  const store = useStore();
  const { doc } = useSnapshot();

  // 单帧数值检查与画面共享同一修订快照。
  const pose = useMemo(() => poseAt(doc, time), [doc, time]);
  const sampled = useMemo(() => sampleDoc(doc, time), [doc, time]);

  const historyLabels = store.historyLabels();

  if (!selectedId || !doc.bones[selectedId]) {
    return (
      <div className="panel right">
        <div className="section-title">检查器</div>
        <div className="muted">在左侧或画面中选择一根骨骼以编辑名称、长度与关节角度约束。</div>
        <HistoryList labels={historyLabels} />
      </div>
    );
  }

  const bone = doc.bones[selectedId];
  const bp = pose.bones[selectedId];
  const frames = doc.frames[selectedId] ?? [];
  const atT = frames.find((f) => Math.abs(f.t - time) < 1e-6);

  const section = (t: string) => <div className="section-title">{t}</div>;

  return (
    <div className="panel right">
      {section('骨骼属性')}
      <div className="field">
        <label>名称</label>
        <input
          type="text"
          value={bone.name}
          onChange={(e) => store.commit(renameBone(store.currentDoc, selectedId, e.target.value), '重命名', 'rename')}
        />
      </div>
      <div className="field">
        <label>静息长度</label>
        <input
          type="number"
          min={1}
          value={Math.round(bone.length * 10) / 10}
          onChange={(e) => {
            const l = Number(e.target.value);
            if (l > 0) store.commit(setBoneLength(store.currentDoc, selectedId, l), '修改长度');
          }}
        />
      </div>
      <div className="field">
        <label>父级</label>
        <input type="text" value={bone.parentId ? doc.bones[bone.parentId].name : '（根）'} disabled />
      </div>

      {section('关节角度约束（度）')}
      <div className="range-row">
        <span className="muted">min</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round(deg(bone.limit.min))}
          onChange={(e) =>
            store.commit(setLimit(store.currentDoc, selectedId, { ...bone.limit, min: rad(Number(e.target.value)) }), '修改约束')
          }
        />
        <span className="val">{Math.round(deg(bone.limit.min))}°</span>
      </div>
      <div className="range-row">
        <span className="muted">max</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round(deg(Math.min(bone.limit.max, Math.PI)))}
          onChange={(e) =>
            store.commit(setLimit(store.currentDoc, selectedId, { ...bone.limit, max: rad(Number(e.target.value)) }), '修改约束')
          }
        />
        <span className="val">{Math.round(deg(Math.min(bone.limit.max, Math.PI)))}°</span>
      </div>
      <div className="row-actions">
        <button
          onClick={() =>
            store.commit(setLimit(store.currentDoc, selectedId, { min: -Math.PI, max: Math.PI }), '重置约束')
          }
        >
          解除约束
        </button>
        <button
          onClick={() => store.commit(setLimit(store.currentDoc, selectedId, { min: 0, max: 0 }), '锁定关节')}
        >
          锁定为 0°
        </button>
      </div>

      {section(`关键帧 @ t=${time.toFixed(2)}s`)}
      <div className="muted" style={{ marginBottom: 4 }}>
        关键帧保存该骨的局部角度（相对父骨）与可选长度。
      </div>
      {atT ? (
        <div>
          <div className="field">
            <label>局部角</label>
            <input
              type="number"
              step={1}
              value={Math.round(deg(atT.angle))}
              onChange={(e) =>
                store.commit(
                  upsertFrame(store.currentDoc, selectedId, { ...atT, angle: rad(Number(e.target.value)) }),
                  '编辑关键帧',
                  'frame-edit',
                )
              }
            />
          </div>
          <div className="field">
            <label>长度</label>
            <input
              type="number"
              min={1}
              value={atT.length ? Math.round(atT.length * 10) / 10 : ''}
              placeholder={`静息 ${bone.length}`}
              onChange={(e) => {
                const l = e.target.value === '' ? undefined : Number(e.target.value);
                store.commit(
                  upsertFrame(store.currentDoc, selectedId, { ...atT, length: l }),
                  '编辑关键帧',
                  'frame-edit',
                );
              }}
            />
          </div>
          <button className="danger" onClick={() => store.commit(deleteFrame(store.currentDoc, selectedId, atT.t), '删除关键帧')}>
            删除此帧
          </button>
        </div>
      ) : (
        <button
          className="primary"
          onClick={() =>
            store.commit(
              upsertFrame(store.currentDoc, selectedId, {
                t: time,
                angle: sampled.angles[selectedId] ?? 0,
                length: sampled.lengths[selectedId] === bone.length ? undefined : sampled.lengths[selectedId],
              }),
              '新建关键帧',
            )
          }
        >
          在当前时刻插入关键帧（{Math.round(deg(sampled.angles[selectedId] ?? 0))}°）
        </button>
      )}
      {frames.length > 0 && (
        <table className="frame-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>t</th>
              <th>局部角</th>
              <th>长度</th>
            </tr>
          </thead>
          <tbody>
            {frames.map((f) => (
              <tr key={f.t}>
                <td>{f.t.toFixed(2)}</td>
                <td>{Math.round(deg(f.angle))}°</td>
                <td>{f.length ? f.length.toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {section('当前帧数值检查')}
      <div className="pose-readout">
{`局部角: ${Math.round(deg(sampled.angles[selectedId] ?? 0))}°
世界角: ${Math.round(deg(bp.worldAngle))}°
长度:   ${(sampled.lengths[selectedId] ?? bone.length).toFixed(1)}
起点:   (${bp.start.x.toFixed(1)}, ${bp.start.y.toFixed(1)})
末端:   (${bp.end.x.toFixed(1)}, ${bp.end.y.toFixed(1)})
约束内: ${sampled.angles[selectedId] >= bone.limit.min - 1e-6 && sampled.angles[selectedId] <= bone.limit.max + 1e-6 ? '是' : '否'}`}
      </div>

      <HistoryList labels={historyLabels} />
    </div>
  );
}

function HistoryList({ labels }: { labels: { label: string; active: boolean }[] }) {
  return (
    <>
      <div className="section-title">统一撤销历史</div>
      <div className="history-list">
        {labels
          .slice()
          .reverse()
          .map((l, i) => (
            <div key={i} className={`h-row${l.active ? ' active' : ''}`}>
              {l.active ? '▶ ' : '  '}
              {l.label}
            </div>
          ))}
      </div>
    </>
  );
}
