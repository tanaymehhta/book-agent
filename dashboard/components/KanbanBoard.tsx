'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { BandRow, BandStatus } from '@/lib/types';
import { BandCard } from './BandCard';
import { ThreadPanel } from './ThreadPanel';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const COLUMNS: { status: BandStatus; title: string; hint: string; dot: string }[] = [
  { status: 'incoming',        title: 'Incoming',        hint: 'fresh leads', dot: 'bg-accent' },
  { status: 'in_conversation', title: 'In Conversation', hint: 'back & forth', dot: 'bg-amber' },
  { status: 'approved',        title: 'On the Roster',   hint: 'cleared to play', dot: 'bg-moss' },
];

export function KanbanBoard() {
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  const [deletingBandId, setDeletingBandId] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR<{ bands: BandRow[] }>(
    '/api/bands',
    fetcher,
    { refreshInterval: 15000, revalidateOnFocus: true },
  );

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

  return (
    <div className="flex h-screen flex-col">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="px-10 pt-8 pb-6">
        <div className="flex items-end justify-between gap-6">
          <div>
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
              </div>
              {isLoading && (
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-4">
                  syncing…
                </div>
              )}
            </div>
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
          </div>
        </div>

        <div className="mt-6 h-px w-full bg-line-strong" />
      </header>

      {selectedBandId && (
        <ThreadPanel
          bandId={selectedBandId}
          onClose={() => setSelectedBandId(null)}
          onSent={() => mutate()}
        />
      )}

      {/* ── COLUMNS ─────────────────────────────────────────── */}
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

            <div className="flex-1 space-y-2.5 overflow-y-auto pr-1 -mr-1">
              {(grouped[col.status] ?? []).map((b, i) => (
                <div
                  key={b.id}
                  className="fade-up"
                  style={{ animationDelay: `${idx * 90 + i * 40 + 140}ms` }}
                >
                  <BandCard
                    band={b}
                    onClick={() => setSelectedBandId(b.id)}
                    onDelete={handleDeleteBand}
                    deleting={deletingBandId === b.id}
                  />
                </div>
              ))}
              {(grouped[col.status] ?? []).length === 0 && (
                <div className="pt-10 text-center font-display italic text-[15px] text-ink-4">
                  nothing here yet.
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
