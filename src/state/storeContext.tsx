import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { RevisionStore } from '../core/store';
import { createDoc } from '../core/doc';

const StoreContext = createContext<RevisionStore | null>(null);

export function createStore(): RevisionStore {
  return new RevisionStore(createDoc());
}

export function StoreProvider({ store, children }: { store: RevisionStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): RevisionStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreProvider 缺失');
  return s;
}

/** 订阅同一修订快照；播放画面、检查面板、导出读取的均为此值。 */
export function useSnapshot() {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );
}
