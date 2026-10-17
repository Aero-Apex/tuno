import { GripVertical, Play, X } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { itemArtist, itemCover, itemTitle, usePlayer, type QueueItem } from '../store/player';
import { useUI } from '../store/ui';
import { Cover } from './Cover';
import { Equalizer } from './Equalizer';
import { useContextName } from '../lib/playContext';

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
  const ctx = useContextName();
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
      className="group flex items-center gap-3 rounded-md p-2 hover:bg-text/10"
    >
      <button onClick={() => (isCurrent ? usePlayer.getState().toggle() : jumpTo(i))} className="relative shrink-0" aria-label={`Play ${itemTitle(q)}`}>
        <Cover src={itemCover(q)} className="h-12 w-12 shadow-none" />
        <span className={`cover absolute inset-0 items-center justify-center bg-black/50 ${isCurrent && playing ? 'flex' : 'hidden group-hover:flex'}`}>
          {isCurrent && playing ? <Equalizer /> : <Play className="h-4 w-4 fill-white text-white" />}
        </span>
      </button>
      <div className="min-w-0 flex-1 cursor-default" onClick={() => compact && jumpTo(i)}>
        <div className={`truncate ${isCurrent ? 'text-accent' : ''}`}>{itemTitle(q)}</div>
        <div className="truncate text-sm text-muted">{itemArtist(q)}</div>
      </div>
      {!isCurrent && (
        <>
          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100 max-md:hidden" />
          <button onClick={() => removeFromQueue(q.qid)} className="icon-btn p-1 opacity-0 group-hover:opacity-100 max-md:opacity-100" aria-label="Remove from queue">
            <X className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );

  if (!queue.length)
    return (
      <div className="px-4 py-16 text-center">
        <div className="text-xl font-bold">Add to your queue</div>
        <p className="mt-2 text-sm text-muted">Tap “Add to queue” from a song's menu to see it here.</p>
      </div>
    );

  return (
    <div>
      {current && (
        <>
          <h3 className="px-2 pb-2 pt-2 font-bold">Now playing</h3>
          {row(current, index, true)}
        </>
      )}
      {upcoming.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-6">
            <h3 className="truncate font-bold">Next from: {ctx.name}</h3>
            <button onClick={clearQueue} className="shrink-0 text-sm font-bold text-muted hover:text-text hover:underline">
              Clear queue
            </button>
          </div>
          {upcoming.slice(0, 300).map((q, i) => row(q, index + 1 + i))}
        </>
      )}
    </div>
  );
}

export function QueuePanel() {
  const setRightPanel = useUI((s) => s.setRightPanel);
  return (
    <aside className="panel flex h-full w-[300px] shrink-0 flex-col max-lg:hidden xl:w-[340px] 2xl:w-[400px]">
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <h2 className="font-bold">Queue</h2>
        <button onClick={() => setRightPanel(null)} className="icon-btn hover:bg-text/10" aria-label="Close queue">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <QueueList />
      </div>
    </aside>
  );
}
