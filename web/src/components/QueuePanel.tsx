import { GripVertical, X } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { itemArtist, itemCover, itemTitle, usePlayer, type QueueItem } from '../store/player';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { Equalizer } from './Equalizer';

export function QueueList({ compact }: { compact?: boolean }) {
  const { queue, index, jumpTo, removeFromQueue, moveInQueue, clearQueue, playing } = usePlayer(
    useShallow((s) => ({
      queue: s.queue,
      index: s.index,
      jumpTo: s.jumpTo,
      removeFromQueue: s.removeFromQueue,
      moveInQueue: s.moveInQueue,
      clearQueue: s.clearQueue,
      playing: s.playing,
    })),
  );
  const [drag, setDrag] = useState<number | null>(null);
  const current = queue[index];
  const upcoming = queue.slice(index + 1);

  const row = (q: QueueItem, i: number, isCurrent = false) => (
    <div
      key={q.qid}
      draggable={!isCurrent}
      onDragStart={() => setDrag(i)}
      onDragOver={(e) => drag !== null && e.preventDefault()}
      onDrop={() => {
        if (drag !== null && drag !== i) moveInQueue(drag, i);
        setDrag(null);
      }}
      onDoubleClick={() => jumpTo(i)}
      className="group flex items-center gap-3 rounded p-2 hover:bg-text/10"
    >
      {!isCurrent && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100" />}
      <button onClick={() => jumpTo(i)} className="shrink-0">
        <Cover src={itemCover(q)} className="h-10 w-10" />
      </button>
      <div className="min-w-0 flex-1 cursor-default" onClick={() => compact && jumpTo(i)}>
        <div className={`truncate text-sm font-medium ${isCurrent ? 'text-accent' : ''}`}>{itemTitle(q)}</div>
        <div className="truncate text-xs text-muted">{itemArtist(q)}</div>
      </div>
      {isCurrent && playing && <Equalizer />}
      {!isCurrent && (
        <button onClick={() => removeFromQueue(q.qid)} className="icon-btn p-1 opacity-0 group-hover:opacity-100 max-md:opacity-100" aria-label="Remove from queue">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  if (!queue.length) return <p className="px-2 py-8 text-center text-sm text-muted">Your queue is empty. Play something!</p>;

  return (
    <div>
      {current && (
        <>
          <h3 className="label px-2 pb-1 pt-2">Now playing</h3>
          {row(current, index, true)}
        </>
      )}
      {upcoming.length > 0 && (
        <>
          <div className="flex items-center justify-between px-2 pb-1 pt-4">
            <h3 className="label">Next up · {upcoming.length}</h3>
            <button onClick={clearQueue} className="text-xs font-semibold text-muted hover:text-text">
              Clear
            </button>
          </div>
          {upcoming.slice(0, 300).map((q, i) => row(q, index + 1 + i))}
        </>
      )}
    </div>
  );
}

export function QueuePanel() {
  const toggleQueue = useUI((s) => s.toggleQueue);
  return (
    <aside className="panel flex h-full w-80 shrink-0 flex-col max-lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="font-bold">Queue</h2>
        <button onClick={toggleQueue} className="icon-btn" aria-label="Close queue">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <QueueList />
      </div>
    </aside>
  );
}
