'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  defaultDropAnimationSideEffects,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import type { BandRow, BandStatus } from '@/lib/types';
import { BandCard } from './BandCard';
import { ThreadPanel } from './ThreadPanel';

const DROPPABLE_STATUSES: BandStatus[] = ['incoming', 'in_conversation', 'approved'];

const dropAnimation: DropAnimation = {
  duration: 260,
  easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0' } },
  }),
};

function isMissingProfile(band: BandRow): boolean {
  return band.status === 'approved' && !(band.name && band.name.trim().length > 0);
}

function DroppableColumn({
  status,
  isDraggingFrom,
  children,
}: {
  status: BandStatus;
  isDraggingFrom: BandStatus | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  const showHighlight = isOver && isDraggingFrom !== null && isDraggingFrom !== status;
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 space-y-2.5 overflow-y-auto pr-1 -mr-1 rounded-lg transition ${
        showHighlight ? 'bg-paper-deep/60 ring-2 ring-accent/40' : ''
      }`}
    >
      {children}
    </div>
  );
}

function DraggableBandCard({
  band,
  onClick,
  onDelete,
  deleting,
  onMove,
  moving,
}: {
  band: BandRow;
  onClick: () => void;
  onDelete: (b: BandRow) => void;
  deleting: boolean;
  onMove: (b: BandRow, s: BandStatus) => void;
  moving: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `band:${band.id}`,
    data: { status: band.status },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={isDragging ? { opacity: 0 } : undefined}
      className="touch-none"
    >
      <BandCard
        band={band}
        onClick={onClick}
        onDelete={onDelete}
        deleting={deleting}
        onMove={onMove}
        moving={moving}
        incompleteProfile={isMissingProfile(band)}
      />
    </div>
  );
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type MailboxPayload = { email: string; provider: string };

async function mailboxFetcher(url: string): Promise<MailboxPayload> {
  const res = await fetch(url);
  const json = (await res.json()) as MailboxPayload & { error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(json.detail ?? json.error ?? 'Could not load mailbox');
  }
  if (typeof json.email !== 'string' || !json.email) {
    throw new Error('Invalid mailbox response');
  }
  return { email: json.email, provider: json.provider };
}

const COLUMNS: { status: BandStatus; title: string; hint: string; dot: string }[] = [
  { status: 'incoming',        title: 'Incoming',        hint: 'fresh leads', dot: 'bg-accent' },
  { status: 'in_conversation', title: 'In Conversation', hint: 'back & forth', dot: 'bg-amber' },
  { status: 'approved',        title: 'On the Roster',   hint: 'cleared to play', dot: 'bg-moss' },
];

const BASE_TITLE = 'Lookout Booking · the taproom desk';
const MUTE_KEY = 'lookout.notifications.muted';
const NOTIFIED_KEY = 'lookout.notifications.lastSeen';

function needsReply(b: BandRow): boolean {
  return b.last_direction === 'inbound' && b.status !== 'archived';
}

function buildFaviconDataUrl(count: number): string {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  // base circle
  ctx.fillStyle = '#f5efe6';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c1917';
  ctx.font = 'bold 28px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('L', 32, 34);
  if (count > 0) {
    // red dot with count
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(50, 14, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px -apple-system, system-ui, sans-serif';
    ctx.fillText(count > 9 ? '9+' : String(count), 50, 16);
  }
  return c.toDataURL('image/png');
}

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

let audioCtx: AudioContext | null = null;
function playChime() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const make = (freq: number, start: number, dur: number, peak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(peak, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };
    make(880, 0, 0.25, 0.12);
    make(1320, 0.08, 0.3, 0.09);
  } catch {
    // sound is best-effort; silent failure is fine
  }
}

export function KanbanBoard() {
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [deletingBandId, setDeletingBandId] = useState<string | null>(null);
  const [movingBandId, setMovingBandId] = useState<string | null>(null);
  const [draggingBand, setDraggingBand] = useState<BandRow | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const { data, error, isLoading, mutate } = useSWR<{ bands: BandRow[] }>(
    '/api/bands',
    fetcher,
    { refreshInterval: 15000, revalidateOnFocus: true },
  );

  const {
    data: mailboxData,
    error: mailboxError,
    isLoading: mailboxLoading,
  } = useSWR<MailboxPayload>(
    '/api/mailbox',
    mailboxFetcher,
    { refreshInterval: 30000, revalidateOnFocus: true },
  );

  // ── Needs-reply count + notification plumbing ──────────────
  const allBands = data?.bands ?? [];
  const needsReplyCount = useMemo(
    () => allBands.filter(needsReply).length,
    [allBands],
  );

  const [muted, setMuted] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    'default',
  );
  // map: band_id -> last_activity_at we've already alerted for
  const seenRef = useRef<Map<string, string>>(new Map());
  const baselinedRef = useRef(false);

  // Mount: load mute pref, check Notification support
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setMuted(window.localStorage.getItem(MUTE_KEY) === '1');
    if ('Notification' in window) {
      setNotifPermission(Notification.permission);
    } else {
      setNotifPermission('unsupported');
    }
    // Seed seen-set from localStorage so a hard refresh doesn't spam
    try {
      const raw = window.localStorage.getItem(NOTIFIED_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, string>;
        seenRef.current = new Map(Object.entries(obj));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Detect new inbound activity → play chime + notify
  useEffect(() => {
    if (!allBands.length && !baselinedRef.current) return;

    const targets = allBands.filter(needsReply);
    if (!baselinedRef.current) {
      // First load: take a snapshot without firing anything.
      const seeded = new Map<string, string>();
      for (const b of targets) {
        if (b.last_activity_at) seeded.set(b.id, b.last_activity_at);
      }
      seenRef.current = seeded;
      baselinedRef.current = true;
      try {
        window.localStorage.setItem(
          NOTIFIED_KEY,
          JSON.stringify(Object.fromEntries(seeded)),
        );
      } catch {
        /* ignore */
      }
      return;
    }

    const fresh: BandRow[] = [];
    for (const b of targets) {
      const last = b.last_activity_at ?? '';
      const prev = seenRef.current.get(b.id);
      if (!prev || (last && last > prev)) {
        fresh.push(b);
        seenRef.current.set(b.id, last);
      }
    }

    if (fresh.length > 0) {
      try {
        window.localStorage.setItem(
          NOTIFIED_KEY,
          JSON.stringify(Object.fromEntries(seenRef.current)),
        );
      } catch {
        /* ignore */
      }
      if (!muted) playChime();
      if (notifPermission === 'granted' && typeof document !== 'undefined' && document.hidden) {
        for (const b of fresh.slice(0, 3)) {
          try {
            new Notification('Lookout Booking', {
              body: `${b.name ?? b.primary_email ?? 'A band'} replied — needs your attention`,
              tag: `band-${b.id}`,
              icon: '/favicon.ico',
            });
          } catch {
            /* ignore */
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBands.map((b) => `${b.id}:${b.last_activity_at ?? ''}:${b.last_direction ?? ''}`).join('|')]);

  // Document title + favicon dot reflect the count
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = needsReplyCount > 0 ? `(${needsReplyCount}) ${BASE_TITLE}` : BASE_TITLE;
    try {
      setFavicon(buildFaviconDataUrl(needsReplyCount));
    } catch {
      /* ignore */
    }
  }, [needsReplyCount]);

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function requestNotifPermission() {
    if (notifPermission === 'unsupported') return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    } catch {
      /* ignore */
    }
  }

  async function handleMoveBand(band: BandRow, newStatus: BandStatus) {
    if (movingBandId || band.status === newStatus) return;
    setMovingBandId(band.id);
    const optimistic = {
      bands: (data?.bands ?? []).map((b) =>
        b.id === band.id ? { ...b, status: newStatus } : b,
      ),
    };
    try {
      await mutate(
        async () => {
          const res = await fetch(`/api/bands/${band.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => null);
            throw new Error(json?.error ?? 'Failed to move band');
          }
          return optimistic;
        },
        {
          optimisticData: optimistic,
          rollbackOnError: true,
          revalidate: true,
          populateCache: true,
        },
      );
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to move band');
    } finally {
      setMovingBandId(null);
    }
  }

  async function handleDeleteBand(band: BandRow) {
    if (deletingBandId) return;
    const label = band.name ?? band.primary_email ?? 'this band';
    const confirmed = window.confirm(`Remove ${label} from the pipeline? This cannot be undone.`);
    if (!confirmed) return;
    setDeletingBandId(band.id);
    try {
      const res = await fetch(`/api/bands/${band.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? 'Failed to delete band');
      }
      if (selectedBandId === band.id) setSelectedBandId(null);
      await mutate();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete band');
    } finally {
      setDeletingBandId(null);
    }
  }

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    if (!id.startsWith('band:')) return;
    const bandId = id.slice('band:'.length);
    const band = (data?.bands ?? []).find((b) => b.id === bandId) ?? null;
    setDraggingBand(band);
  }

  function handleDragEnd(e: DragEndEvent) {
    const active = String(e.active.id);
    setDraggingBand(null);
    if (!active.startsWith('band:') || !e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith('col:')) return;
    const targetStatus = overId.slice('col:'.length) as BandStatus;
    if (!DROPPABLE_STATUSES.includes(targetStatus)) return;
    const bandId = active.slice('band:'.length);
    const band = (data?.bands ?? []).find((b) => b.id === bandId);
    if (!band || band.status === targetStatus) return;
    void handleMoveBand(band, targetStatus);
  }

  if (error) {
    return (
      <div className="p-10">
        <div className="font-display text-3xl italic text-accent">Something went sideways.</div>
        <p className="mt-2 text-sm text-ink-3">Failed to load bands · {String(error)}</p>
      </div>
    );
  }

  const bands = data?.bands ?? [];
  const grouped: Record<BandStatus, BandRow[]> = {
    incoming: [],
    in_conversation: [],
    approved: [],
    archived: [],
  };
  for (const b of bands) grouped[b.status]?.push(b);
  // Sort: needs-reply first, then most recent activity first.
  for (const k of Object.keys(grouped) as BandStatus[]) {
    grouped[k].sort((a, b) => {
      const ra = needsReply(a) ? 0 : 1;
      const rb = needsReply(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const ta = a.last_activity_at ?? '';
      const tb = b.last_activity_at ?? '';
      return tb.localeCompare(ta);
    });
  }

  return (
    <div className="flex h-screen flex-col">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="px-10 pt-8 pb-6">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="mb-2 font-mono text-[11px] text-ink-4">
              <span className="uppercase tracking-[0.14em]">Tracking </span>
              {mailboxError ? (
                <span className="italic text-ink-4">could not load mailbox</span>
              ) : mailboxData?.email ? (
                <span className="font-medium text-ink-2">{mailboxData.email}</span>
              ) : (
                <span className="text-ink-3">{mailboxLoading ? '…' : '—'}</span>
              )}
            </p>
            <div className="flex items-baseline gap-2">
              <h1 className="text-[28px] font-[600] tracking-[-0.015em] text-ink">
                Lookout Booking
              </h1>
              <span className="font-display italic text-[22px] text-accent/90 leading-none">
                &
              </span>
              <span className="text-[14px] text-ink-3 pb-[2px]">the taproom desk</span>
            </div>
            <p className="mt-1 font-display italic text-[16px] text-ink-3">
              a calendar of conversations in motion.
            </p>
          </div>

          <div className="flex items-center gap-4 pb-1">
            <div className="text-right">
              <div className="flex items-baseline gap-1.5 justify-end">
                <span className="text-[22px] font-[600] text-ink tabular-nums">
                  {bands.length}
                </span>
                <span className="font-display italic text-sm text-ink-3">active</span>
                {needsReplyCount > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-accent-soft/70 px-2.5 py-0.5 text-[11px] font-[600] text-accent-deep">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" />
                    {needsReplyCount} need {needsReplyCount === 1 ? 'a' : ''} reply
                  </span>
                )}
              </div>
              {isLoading && (
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                  syncing…
                </div>
              )}
            </div>
            {notifPermission === 'default' && (
              <button
                onClick={requestNotifPermission}
                title="Enable desktop notifications when bands reply"
                className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper-2 px-3 py-1.5 text-[12px] font-[500] text-ink-2 transition hover:border-ink/30 hover:bg-paper-deep"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 12h9l-1-1.5v-3a3.5 3.5 0 0 0-7 0v3z" />
                  <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
                </svg>
                Enable notifications
              </button>
            )}
            <button
              onClick={toggleMute}
              title={muted ? 'Unmute notification sound' : 'Mute notification sound'}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-paper-2 text-ink-3 transition hover:border-ink/30 hover:bg-paper-deep hover:text-ink-2"
            >
              {muted ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6h2l3-2.5v9L4 10H2z" />
                  <path d="M10 6l4 4M14 6l-4 4" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6h2l3-2.5v9L4 10H2z" />
                  <path d="M10 5.5a3 3 0 0 1 0 5" />
                  <path d="M12 4a5 5 0 0 1 0 8" />
                </svg>
              )}
            </button>
            <button
              onClick={() => mutate()}
              className="group inline-flex items-center gap-2 rounded-full border border-line-strong bg-paper-2 px-3.5 py-1.5 text-[13px] font-[500] text-ink-2 transition hover:border-ink/30 hover:bg-paper-deep"
              aria-label="Refresh"
            >
              <svg
                className="h-3.5 w-3.5 text-ink-3 transition group-hover:text-accent group-hover:rotate-180"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
                <path d="M13.5 2v3h-3" />
              </svg>
              Refresh
            </button>
            <form method="POST" action="/api/logout">
              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-line-strong bg-paper-2 px-3.5 py-1.5 text-[13px] font-[500] text-ink-3 transition hover:border-ink/30 hover:bg-paper-deep hover:text-ink-2"
                aria-label="Log out"
              >
                Log out
              </button>
            </form>
          </div>
        </div>

        <div className="mt-6 h-px w-full bg-line-strong" />
      </header>

      {selectedBandId && (
        <ThreadPanel
          bandId={selectedBandId}
          onClose={() => setSelectedBandId(null)}
          onSent={() => mutate()}
          showProfile={
            bands.find((b) => b.id === selectedBandId)?.status === 'approved'
          }
        />
      )}

      {/* ── COLUMNS ─────────────────────────────────────────── */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingBand(null)}
      >
        <div className="grid flex-1 grid-cols-3 gap-6 overflow-hidden px-10 pb-8">
          {COLUMNS.map((col, idx) => (
            <section
              key={col.status}
              className="fade-up flex min-h-0 flex-col"
              style={{ animationDelay: `${idx * 90}ms` }}
            >
              <div className="mb-3 flex items-end justify-between">
                <div className="flex items-baseline gap-2.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${col.dot} translate-y-[-2px]`} />
                  <h2 className="text-[15px] font-[600] tracking-[-0.005em] text-ink">
                    {col.title}
                  </h2>
                  <span className="font-display italic text-[14px] text-ink-3">
                    {col.hint}
                  </span>
                </div>
                <span className="text-[12px] font-[500] text-ink-3 tabular-nums">
                  {grouped[col.status]?.length ?? 0}
                </span>
              </div>

              <DroppableColumn
                status={col.status}
                isDraggingFrom={draggingBand?.status ?? null}
              >
                {(grouped[col.status] ?? []).map((b, i) => (
                  <div
                    key={b.id}
                    className="fade-up"
                    style={{ animationDelay: `${idx * 90 + i * 40 + 140}ms` }}
                  >
                    <DraggableBandCard
                      band={b}
                      onClick={() => setSelectedBandId(b.id)}
                      onDelete={handleDeleteBand}
                      deleting={deletingBandId === b.id}
                      onMove={handleMoveBand}
                      moving={movingBandId === b.id}
                    />
                  </div>
                ))}
                {(grouped[col.status] ?? []).length === 0 && (
                  <div className="pt-10 text-center font-display italic text-[15px] text-ink-4">
                    nothing here yet.
                  </div>
                )}
              </DroppableColumn>
            </section>
          ))}
        </div>
        <DragOverlay dropAnimation={dropAnimation}>
          {draggingBand ? (
            <div className="rotate-1 opacity-95">
              <BandCard
                band={draggingBand}
                incompleteProfile={isMissingProfile(draggingBand)}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
