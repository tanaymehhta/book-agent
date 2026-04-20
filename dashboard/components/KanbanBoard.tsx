'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { BandRow, BandStatus } from '@/lib/types';
import { BandCard } from './BandCard';
import { ThreadPanel } from './ThreadPanel';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const COLUMNS: { status: BandStatus; title: string; hint: string }[] = [
  { status: 'incoming', title: 'Incoming', hint: 'Auto-acknowledged, not engaged yet' },
  { status: 'in_conversation', title: 'In Conversation', hint: 'Active back-and-forth' },
  { status: 'approved', title: 'Approved', hint: 'Cleared after first gig' },
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
    const confirmed = window.confirm(`Delete ${label} from the pipeline? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingBandId(band.id);
    try {
      const res = await fetch(`/api/bands/${band.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? 'Failed to delete band');
      }
      if (selectedBandId === band.id) {
        setSelectedBandId(null);
      }
      await mutate();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete band');
    } finally {
      setDeletingBandId(null);
    }
  }

  if (error) {
    return (
      <div className="p-8 text-red-400">
        Failed to load bands: {String(error)}
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
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold">Lookout Booking</h1>
          <p className="text-xs text-muted">
            {isLoading ? 'loading…' : `${bands.length} active bands`}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="rounded border border-border bg-surface px-3 py-1 text-sm hover:bg-surface-2"
        >
          Refresh
        </button>
      </header>

      {selectedBandId && (
        <ThreadPanel
          bandId={selectedBandId}
          onClose={() => setSelectedBandId(null)}
          onSent={() => mutate()}
        />
      )}

      <div className="grid flex-1 grid-cols-3 gap-4 overflow-hidden p-4">
        {COLUMNS.map((col) => (
          <section key={col.status} className="flex min-h-0 flex-col rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{col.title}</h2>
                <span className="text-xs text-muted">
                  {grouped[col.status]?.length ?? 0}
                </span>
              </div>
              <p className="text-[11px] text-muted">{col.hint}</p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {(grouped[col.status] ?? []).map((b) => (
                <BandCard
                  key={b.id}
                  band={b}
                  onClick={() => setSelectedBandId(b.id)}
                  onDelete={handleDeleteBand}
                  deleting={deletingBandId === b.id}
                />
              ))}
              {(grouped[col.status] ?? []).length === 0 && (
                <div className="pt-6 text-center text-xs text-muted">— empty —</div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
