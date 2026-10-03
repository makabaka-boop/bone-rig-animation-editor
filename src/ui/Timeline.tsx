import { useSnapshot } from '../state/storeContext';

interface Props {
  time: number;
  playing: boolean;
  selectedId: string | null;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
}

export function Timeline({ time, playing, selectedId, onSeek, onTogglePlay }: Props) {
  const { doc } = useSnapshot();

  // 收集全部关键帧位置；选中骨骼的帧用主色高亮。
  const dots: Array<{ t: number; key: string; selected: boolean }> = [];
  for (const [boneId, fs] of Object.entries(doc.frames)) {
    for (const f of fs) {
      dots.push({ t: f.t, key: `${boneId}@${f.t}`, selected: boneId === selectedId });
    }
  }
  dots.sort((a, b) => a.t - b.t);

  const pct = (t: number) => `${(t / doc.duration) * 100}%`;

  const onTrackMouseDown = (ev: React.MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    onSeek(u * doc.duration);
  };

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button className="primary" onClick={onTogglePlay}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button onClick={() => onSeek(0)}>⏮ 回开头</button>
        <span className="muted">
          {time.toFixed(2)} / {doc.duration.toFixed(2)} s
        </span>
        <input
          type="number"
          min={0.1}
          step={0.1}
          style={{ width: 70 }}
          value={doc.duration}
          onChange={() => {
            /* 时长在顶栏修改；这里仅展示 */
          }}
          disabled
        />
      </div>
      <div className="timeline-track" onMouseDown={onTrackMouseDown} title="点击跳转时刻">
        {dots.map((d) => (
          <div
            key={d.key}
            className={`kf-dot${d.selected ? ' selected-bone' : ''}`}
            style={{ left: pct(d.t) }}
            title={`关键帧 ${d.t.toFixed(2)}s`}
          />
        ))}
        <div className="playhead" style={{ left: pct(time) }} />
      </div>
    </div>
  );
}
