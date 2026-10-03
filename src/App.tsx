import { useCallback, useState } from 'react';
import { createStore, StoreProvider } from './state/storeContext';
import { TopBar } from './ui/TopBar';
import { SkeletonCanvas } from './ui/SkeletonCanvas';
import { StructurePanel } from './ui/StructurePanel';
import { InspectorPanel } from './ui/InspectorPanel';
import { Timeline } from './ui/Timeline';

const store = createStore();

export default function App() {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 2500);
  }, []);

  return (
    <StoreProvider store={store}>
      <div className="app">
        <TopBar />
        <StructurePanel selectedId={selectedId} onSelect={setSelectedId} onError={showError} />
        <SkeletonCanvas
          time={time}
          playing={playing}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onTick={setTime}
        />
        <InspectorPanel selectedId={selectedId} time={time} />
        <Timeline
          time={time}
          playing={playing}
          selectedId={selectedId}
          onSeek={(t) => {
            setPlaying(false);
            setTime(t);
          }}
          onTogglePlay={() => setPlaying((p) => !p)}
        />
        {error && <div className="toast" style={{ position: 'fixed', bottom: 150 }}>{error}</div>}
      </div>
    </StoreProvider>
  );
}
