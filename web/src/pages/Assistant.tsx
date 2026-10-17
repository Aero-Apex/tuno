import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Loader2, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, PageBar } from '../components/Page';
import { api, type PendingChange } from '../lib/api';
import { useUI } from '../store/ui';

type ChangeStatus = 'waiting' | 'working' | 'approved' | 'rejected' | 'failed';
type Change = PendingChange & { status: ChangeStatus; message?: string };
interface Turn {
  role: 'user' | 'assistant';
  content: string;
  changes?: Change[];
  notes?: string[];
}

const STARTERS = ['Make a playlist of my most played songs', 'Find calm songs in my library and put them in a playlist', 'Search Spotify for workout playlists'];

/** Chat with the in-app assistant. It can read your library and propose playlists and downloads; you approve each one (unless bypass is on). */
export function AssistantPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const toast = useUI((s) => s.toast);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy]);

  const patchChange = (turn: number, id: string, patch: Partial<Change>) =>
    setTurns((ts) => ts.map((t, i) => (i === turn ? { ...t, changes: t.changes?.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : t)));

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: message }];
    setTurns(next);
    setInput('');
    setBusy(true);
    try {
      const reply = await api.assistantChat(next.map(({ role, content }) => ({ role, content })));
      setTurns((ts) => [
        ...ts,
        {
          role: 'assistant',
          content: reply.reply,
          changes: reply.pending.map((p) => ({ ...p, status: 'waiting' as const })),
          notes: reply.done.map((d) => `Done: ${d.description}`),
        },
      ]);
      if (reply.done.length) qc.invalidateQueries();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (turn: number, change: Change, approve: boolean) => {
    patchChange(turn, change.id, { status: 'working' });
    try {
      if (approve) {
        await api.approveChange(change.id);
        patchChange(turn, change.id, { status: 'approved' });
        qc.invalidateQueries();
      } else {
        await api.rejectChange(change.id);
        patchChange(turn, change.id, { status: 'rejected' });
      }
    } catch (err) {
      patchChange(turn, change.id, { status: 'failed', message: (err as Error).message });
    }
  };

  return (
    <Page bar={<PageBar back={false} solid />}>
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight">
          <Bot className="h-7 w-7 text-accent" /> Assistant
        </h1>
        <p className="text-sm text-muted">
          {settings?.assistantBypass ? (
            <>Bypass permissions is on, so changes happen straight away.</>
          ) : (
            <>Every change waits for your approval.</>
          )}{' '}
          <Link to="/settings?tab=assistant" className="font-semibold text-text hover:underline">
            Change in Settings
          </Link>
        </p>

        {turns.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-base text-text/90">Ask about your music. Try one of these:</p>
            {STARTERS.map((s) => (
              <button key={s} onClick={() => send(s)} className="chip">
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent/15 px-4 py-2">
              {t.content}
            </div>
          ) : (
            <div key={i} className="flex max-w-[92%] flex-col gap-3">
              <div className="whitespace-pre-wrap rounded-lg bg-text/5 px-4 py-3">{t.content}</div>
              {t.notes?.map((n) => (
                <p key={n} className="px-1 text-sm text-muted">
                  {n}
                </p>
              ))}
              {t.changes?.map((c) => (
                <div key={c.id} className="rounded-lg bg-elevated p-3 ring-1 ring-text/10">
                  <div className="text-sm font-medium">{c.description}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    {c.status === 'waiting' && (
                      <>
                        <button onClick={() => decide(i, c, true)} className="btn-accent">
                          Approve
                        </button>
                        <button onClick={() => decide(i, c, false)} className="btn-subtle">
                          Reject
                        </button>
                      </>
                    )}
                    {c.status === 'working' && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
                    {c.status === 'approved' && (
                      <span className="flex items-center gap-1 font-semibold text-accent">
                        <Check className="h-4 w-4" /> Done
                      </span>
                    )}
                    {c.status === 'rejected' && <span className="text-muted">Rejected</span>}
                    {c.status === 'failed' && <span className="text-red-400">{c.message}</span>}
                  </div>
                </div>
              ))}
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
        <div ref={endRef} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="sticky bottom-4 flex items-end gap-2 rounded-lg bg-elevated p-2 shadow-xl ring-1 ring-text/10"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Ask for a playlist, a song or a search…"
            className="min-h-[2.5rem] flex-1 resize-none bg-transparent p-2 outline-none"
          />
          <button type="submit" disabled={busy || !input.trim()} className="btn-accent" aria-label="Send">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </Page>
  );
}
