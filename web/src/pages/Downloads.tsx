import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Ban, CheckCircle2, Clock, Download, Link2, Loader2, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cover } from '../components/Cover';
import { Empty, Page } from '../components/Page';
import { api, type Job } from '../lib/api';
import { useActions } from '../lib/actions';
import { fmtAgo, SOURCE_COLOR, SOURCE_LABEL } from '../lib/format';
import { useUI } from '../store/ui';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'In progress' },
  { id: 'error', label: 'Failed' },
  { id: 'done', label: 'Finished' },
] as const;

export function DownloadsPage() {
  const { data, refetch } = useQuery({ queryKey: ['jobs'], queryFn: api.jobs });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const openImport = useUI((s) => s.openImport);
  const actions = useActions();
  const jobs = data?.jobs ?? [];
  const count = (s: Job['status'][]) => jobs.filter((j) => s.includes(j.status)).length;
  const active = count(['running', 'queued']);
  const failed = count(['error']);
  const shown = jobs.filter((j) =>
    filter === 'all' ? true : filter === 'active' ? j.status === 'running' || j.status === 'queued' : filter === 'error' ? j.status === 'error' || j.status === 'canceled' : j.status === 'done',
  );

  const act = async (fn: () => Promise<unknown>) => {
    await fn();
    refetch();
  };

  return (
    <Page>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Downloads</h1>
          <p className="mt-1 text-sm text-muted">
            {active ? `${active} in progress` : 'Nothing downloading right now'}
            {failed ? ` · ${failed} failed` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openImport()} className="btn-accent">
            <Link2 className="h-4 w-4" /> Add from link
          </button>
          {failed > 0 && (
            <button onClick={() => act(api.retryFailed)} className="btn-subtle">
              <RotateCcw className="h-4 w-4" /> Retry failed
            </button>
          )}
          {active > 0 && (
            <button onClick={() => act(api.cancelAll)} className="btn-subtle">
              <Ban className="h-4 w-4" /> Cancel all
            </button>
          )}
          {jobs.length > active && (
            <button onClick={() => act(api.clearFinished)} className="btn-subtle">
              Clear finished
            </button>
          )}
        </div>
      </div>

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`shrink-0 ${filter === f.id ? 'chip-active' : 'chip'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty
          icon={<Download className="h-12 w-12" />}
          title={jobs.length ? 'Nothing here' : 'No downloads yet'}
          body="Paste a link to a song, album or playlist and it will show up here while it downloads."
        />
      ) : (
        <div className="space-y-1">
          {shown.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              onAction={act}
              onDelete={() => {
                if (j.trackId) actions.deleteTrack({ id: j.trackId, title: j.title ?? j.query ?? j.url ?? 'this song' });
              }}
            />
          ))}
        </div>
      )}
    </Page>
  );
}

function JobRow({ job: j, onAction, onDelete }: { job: Job; onAction: (fn: () => Promise<unknown>) => void; onDelete: () => void }) {
  const source = j.source ?? 'web';
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-text/5">
      <Cover src={j.thumbnail} className="h-12 w-12 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{j.title ?? j.query ?? j.url}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-bold uppercase text-white" style={{ background: SOURCE_COLOR[source] ?? '#555' }}>
            {SOURCE_LABEL[source] ?? source}
          </span>
          <span className="truncate">{j.artist}</span>
          {j.playlistId && (
            <Link to={`/playlist/${j.playlistId}`} className="hidden shrink-0 hover:text-text hover:underline sm:inline">
              · playlist
            </Link>
          )}
        </div>
        {j.status === 'running' && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-text/10">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(3, j.progress)}%` }} />
          </div>
        )}
        {j.status === 'error' && <div className="mt-1 line-clamp-2 text-xs text-red-400">{j.error}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-sm text-muted">
        {j.status === 'running' && (
          <>
            <span className="tabular-nums">{j.progress >= 99 ? 'Finishing…' : `${Math.round(j.progress)}%`}</span>
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
          </>
        )}
        {j.status === 'queued' && (
          <span className="flex items-center gap-1">
            <Clock className="h-4 w-4" /> Waiting
          </span>
        )}
        {j.status === 'done' && (
          <span className="flex items-center gap-1 text-accent">
            <CheckCircle2 className="h-4 w-4" /> <span className="hidden text-muted sm:inline">{fmtAgo(j.updatedAt)}</span>
          </span>
        )}
        {j.status === 'error' && <AlertCircle className="h-4 w-4 text-red-400" />}
        {j.status === 'canceled' && <span>Canceled</span>}
        {(j.status === 'running' || j.status === 'queued') && (
          <button onClick={() => onAction(() => api.cancelJob(j.id))} className="icon-btn" title="Cancel" aria-label="Cancel">
            <X className="h-4 w-4" />
          </button>
        )}
        {j.status === 'error' && j.query && (
          <Link to={`/search?q=${encodeURIComponent(j.query)}`} className="icon-btn" title="Find it yourself" aria-label="Search for this song">
            <Search className="h-4 w-4" />
          </Link>
        )}
        {(j.status === 'error' || j.status === 'canceled') && (
          <button onClick={() => onAction(() => api.retryJob(j.id))} className="icon-btn" title="Retry" aria-label="Retry">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        {j.status === 'done' && !!j.trackId && (
          <button onClick={onDelete} className="icon-btn hover:text-red-400" title="Delete song from library" aria-label={`Delete ${j.title ?? 'song'} from library`}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
