'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { ThreadDetail, ThreadMessageRow } from '@/lib/types';
import { timeAgo } from '@/lib/format';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const UNDO_WINDOW_MS = 30_000;

interface ThreadPanelProps {
  bandId: string;
  onClose: () => void;
  onSent?: () => void;
}

type PendingSend = {
  draftId: string;
  body: string;
  timer: ReturnType<typeof setTimeout>;
};

export function ThreadPanel({ bandId, onClose, onSent }: ThreadPanelProps) {
  const { data, error, isLoading, mutate } = useSWR<ThreadDetail>(
    `/api/bands/${bandId}/thread`,
    fetcher,
    { refreshInterval: 15000 },
  );

  const [compose, setCompose] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = data?.messages ?? [];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (pending) clearTimeout(pending.timer);
    };
  }, [pending]);

  async function handleSend() {
    const body_text = compose.trim();
    if (!body_text || sending) return;

    setSending(true);
    setSendError(null);

    try {
      const res = await fetch(`/api/bands/${bandId}/drafts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body_text }),
      });
      const json = await res.json();
      if (!res.ok || !json?.id) {
        throw new Error(json?.error || 'Failed to create draft');
      }

      const draftId = json.id as string;
      const timer = setTimeout(() => {
        fireSend(draftId);
      }, UNDO_WINDOW_MS);

      setPending({ draftId, body: body_text, timer });
      setCompose('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  async function fireSend(draftId: string) {
    try {
      const res = await fetch(`/api/drafts/${draftId}/send`, { method: 'POST' });
      if (!res.ok) throw new Error('Send failed');
      setPending(null);
      mutate();
      onSent?.();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
      setPending(null);
    }
  }

  function handleUndo() {
    if (!pending) return;
    clearTimeout(pending.timer);
    setCompose(pending.body);
    setPending(null);
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        aria-label="Close panel"
        onClick={onClose}
        className="flex-1 bg-black/40 backdrop-blur-[1px]"
      />
      <aside className="flex h-full w-[480px] flex-col border-l border-border bg-surface shadow-2xl">
        <header className="flex items-start justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {data?.subject ?? (isLoading ? 'Loading…' : 'Thread')}
            </div>
            <div className="text-xs text-muted">
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              Failed to load thread.
            </div>
          )}
          {isLoading && !data && (
            <div className="pt-8 text-center text-sm text-muted">Loading thread…</div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>

        {pending && (
          <div className="flex items-center justify-between border-t border-border bg-amber-500/10 px-5 py-2 text-sm">
            <span className="text-amber-200">Sending in {UNDO_WINDOW_MS / 1000}s…</span>
            <button
              onClick={handleUndo}
              className="rounded border border-amber-400/40 px-2 py-0.5 text-xs text-amber-200 hover:bg-amber-500/20"
            >
              Undo
            </button>
          </div>
        )}

        <div className="border-t border-border px-5 py-3">
          {sendError && (
            <div className="mb-2 text-xs text-red-300">{sendError}</div>
          )}
          <textarea
            value={compose}
            onChange={(e) => setCompose(e.target.value)}
            placeholder="Write a reply…"
            rows={4}
            disabled={sending || !!pending}
            className="w-full resize-none rounded border border-border bg-surface-2 p-2 text-sm text-white placeholder:text-muted focus:border-blue-500/60 focus:outline-none disabled:opacity-60"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={handleSend}
              disabled={sending || !compose.trim() || !!pending}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function MessageBubble({ message }: { message: ThreadMessageRow }) {
  const isOutbound = message.direction === 'outbound';
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isOutbound
            ? 'bg-blue-600/20 text-blue-50'
            : 'bg-surface-2 text-white'
        }`}
      >
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
          <span>{isOutbound ? 'You' : 'Them'}</span>
          <span>·</span>
          <span>{timeAgo(message.sent_at)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words">
          {message.body_text || message.snippet || '(no body)'}
        </div>
      </div>
    </div>
  );
}
