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
  const [pendingSeconds, setPendingSeconds] = useState(UNDO_WINDOW_MS / 1000);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = data?.messages ?? [];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!pending) return;
    setPendingSeconds(UNDO_WINDOW_MS / 1000);
    const tick = setInterval(() => {
      setPendingSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [pending]);

  useEffect(() => {
    return () => {
      if (pending) clearTimeout(pending.timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (!res.ok || !json?.id) throw new Error(json?.error || 'Failed to create draft');

      const draftId = json.id as string;
      const timer = setTimeout(() => fireSend(draftId), UNDO_WINDOW_MS);
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

  const firstInbound = messages.find((m) => m.direction === 'inbound');
  const fromAddress = firstInbound?.from_address ?? '—';
  const wordCount = compose.trim() ? compose.trim().split(/\s+/).length : 0;

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        aria-label="Close panel"
        onClick={onClose}
        className="flex-1 bg-ink/25 backdrop-blur-[3px]"
      />
      <aside className="slide-in flex h-full w-[560px] flex-col border-l border-line-strong bg-paper shadow-panel">
        {/* ── HEADER ──────────────────────────────────────────── */}
        <header className="relative border-b border-line-strong px-6 pt-5 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[11px] font-[500] text-ink-4">
                <span className="font-display italic text-[13px] text-accent/80">re.</span>
                <span className="h-px w-4 bg-line-strong" />
                <span>conversation</span>
              </div>
              <h2 className="mt-1.5 text-[19px] font-[600] leading-snug tracking-[-0.01em] text-ink line-clamp-2">
                {data?.subject ?? (isLoading ? 'loading…' : 'untitled thread')}
              </h2>
              <div className="mt-2.5 flex items-center gap-3 text-[12px] text-ink-3">
                <span className="truncate">{fromAddress}</span>
                <span className="h-1 w-1 rounded-full bg-ink-4 shrink-0" />
                <span className="shrink-0 font-display italic">
                  {messages.length} {messages.length === 1 ? 'message' : 'messages'}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-full border border-line-strong bg-paper-2 h-8 w-8 flex items-center justify-center text-ink-3 transition hover:border-ink/25 hover:bg-paper-deep hover:text-ink"
              aria-label="Close"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M2 2l10 10M12 2L2 12" />
              </svg>
            </button>
          </div>
        </header>

        {/* ── MESSAGES ────────────────────────────────────────── */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {error && (
            <div className="rounded-xl border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[13px] text-accent-deep">
              Failed to load thread.
            </div>
          )}
          {isLoading && !data && (
            <div className="pt-16 text-center font-display italic text-[15px] text-ink-4">
              fetching the conversation…
            </div>
          )}
          {!isLoading && messages.length === 0 && !error && (
            <div className="pt-16 text-center font-display italic text-[15px] text-ink-4">
              no messages yet.
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>

        {/* ── UNDO BANNER ─────────────────────────────────────── */}
        {pending && (
          <div className="relative border-t border-line-strong bg-amber-soft/40 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] text-ink-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent pulse-soft" />
                <span>
                  sending in{' '}
                  <span className="font-[600] tabular-nums text-accent">
                    {pendingSeconds}s
                  </span>
                </span>
              </div>
              <button
                onClick={handleUndo}
                className="rounded-full border border-ink/20 bg-paper px-3 py-1 text-[12px] font-[500] text-ink-2 transition hover:border-ink/35 hover:bg-paper-deep"
              >
                Undo
              </button>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-px bg-line-strong">
              <div
                className="h-full bg-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${(pendingSeconds / (UNDO_WINDOW_MS / 1000)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* ── COMPOSE ─────────────────────────────────────────── */}
        <div className="border-t border-line-strong bg-paper-2/70 px-6 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-[500] uppercase tracking-[0.14em] text-ink-4">
              Reply
            </span>
            <span className="font-display italic text-[13px] text-ink-3">
              — signed, Laura
            </span>
          </div>
          {sendError && (
            <div className="mb-2 rounded-md border-l-2 border-accent bg-accent-soft/40 px-2 py-1 text-[12px] text-accent-deep">
              {sendError}
            </div>
          )}
          <textarea
            value={compose}
            onChange={(e) => setCompose(e.target.value)}
            placeholder="write a reply…"
            rows={5}
            disabled={sending || !!pending}
            className="w-full resize-none rounded-xl border border-line-strong bg-paper px-3.5 py-3 text-[14px] leading-relaxed text-ink placeholder:font-display placeholder:italic placeholder:text-ink-4 focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-accent/20 transition disabled:opacity-60"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-ink-4">
              {wordCount === 0 ? 'blank page' : `${wordCount} word${wordCount === 1 ? '' : 's'}`}
            </span>
            <button
              onClick={handleSend}
              disabled={sending || !compose.trim() || !!pending}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-[500] text-paper transition hover:bg-accent disabled:cursor-not-allowed disabled:bg-ink-4"
            >
              {sending ? 'sending…' : 'Send reply'}
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6h8M7 3l3 3-3 3" />
              </svg>
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
      <div className={`max-w-[86%] ${isOutbound ? 'items-end' : 'items-start'}`}>
        <div
          className={`mb-1 flex items-center gap-1.5 text-[10px] font-[500] uppercase tracking-[0.14em] ${
            isOutbound ? 'justify-end text-accent' : 'text-ocean'
          }`}
        >
          <span>{isOutbound ? 'you' : 'them'}</span>
          <span className="h-0.5 w-0.5 rounded-full bg-ink-4" />
          <span className="font-mono normal-case tracking-normal text-ink-4">
            {timeAgo(message.sent_at)}
          </span>
        </div>
        <div
          className={`rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words ${
            isOutbound
              ? 'bg-ink text-paper rounded-tr-md'
              : 'bg-paper-2 border border-line text-ink-2 rounded-tl-md'
          }`}
        >
          {message.body_text || message.snippet || (
            <span className="font-display italic opacity-60">(no body)</span>
          )}
        </div>
      </div>
    </div>
  );
}
