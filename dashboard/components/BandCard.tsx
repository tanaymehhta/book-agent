'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { BandInsights, BandRow } from '@/lib/types';
import { daysSince, timeAgo } from '@/lib/format';

const STAGE_LABELS: Record<string, string> = {
  new_lead: 'New',
  collecting_details: 'Collecting Info',
  negotiating_terms: 'Negotiating',
  pending_confirmation: 'Pending Confirm',
  confirmed: 'Confirmed',
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BandCardProps {
  band: BandRow;
  onClick?: () => void;
  onDelete?: (band: BandRow) => void;
  deleting?: boolean;
}

export function BandCard({ band, onClick, onDelete, deleting = false }: BandCardProps) {
  if (band.status === 'approved') {
    return <ApprovedCard band={band} onClick={onClick} onDelete={onDelete} deleting={deleting} />;
  }
  return <FullCard band={band} onClick={onClick} onDelete={onDelete} deleting={deleting} />;
}

function ApprovedCard({
  band,
  onClick,
  onDelete,
  deleting,
}: {
  band: BandRow;
  onClick?: () => void;
  onDelete?: (band: BandRow) => void;
  deleting?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-sm transition hover:border-border/80 hover:bg-surface-2/80 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="truncate text-sm font-medium">{band.name ?? '(unknown)'}</div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{band.contact_name ?? band.primary_email}</span>
        {band.contact_name && band.primary_email && (
          <span className="shrink-0 truncate text-muted/70">{band.primary_email}</span>
        )}
      </div>
      {onDelete && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(band);
            }}
            disabled={deleting}
            className="rounded bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? 'deleting…' : 'delete'}
          </button>
        </div>
      )}
    </div>
  );
}

function FullCard({
  band,
  onClick,
  onDelete,
  deleting,
}: {
  band: BandRow;
  onClick?: () => void;
  onDelete?: (band: BandRow) => void;
  deleting?: boolean;
}) {
  const stale = daysSince(band.last_activity_at) >= 14;
  const awaitingReply = band.last_direction === 'outbound';
  const [expanded, setExpanded] = useState(false);

  const { data: insights } = useSWR<BandInsights>(
    expanded ? `/api/bands/${band.id}/insights` : null,
    fetcher,
  );

  return (
    <div
      className={`rounded-lg border border-border bg-surface-2 p-3 shadow-sm transition hover:border-border/80 hover:bg-surface-2/80 ${stale ? 'opacity-50' : ''}`}
    >
      <div
        onClick={onClick}
        className={`flex items-start justify-between gap-2 ${onClick ? 'cursor-pointer' : ''}`}
      >
        <div className="min-w-0">
          <div className="truncate font-medium">{band.name ?? '(unknown)'}</div>
          <div className="truncate text-xs text-muted">{band.primary_email}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {band.needs_review && (
            <span
              title="Needs human review"
              className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-300"
            >
              review
            </span>
          )}
          {band.draft_ready && (
            <span
              title="Draft ready to send"
              className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300"
            >
              draft
            </span>
          )}
          {awaitingReply && !band.draft_ready && (
            <span
              title="Awaiting their reply"
              className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-300"
            >
              awaiting
            </span>
          )}
        </div>
      </div>

      {band.last_snippet && (
        <p
          onClick={onClick}
          className={`mt-2 line-clamp-2 text-sm text-muted ${onClick ? 'cursor-pointer' : ''}`}
        >
          <span className="text-xs uppercase text-muted/70 mr-1">
            {band.last_direction === 'outbound' ? 'you' : 'them'}:
          </span>
          {band.last_snippet}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{timeAgo(band.last_activity_at)}</span>
        <div className="flex items-center gap-2">
          {band.conversation_stage && (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px]">
              {STAGE_LABELS[band.conversation_stage] ?? band.conversation_stage}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="rounded bg-surface px-1.5 py-0.5 text-[10px] hover:bg-surface/60"
          >
            {expanded ? 'less ▴' : 'more ▾'}
          </button>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(band);
              }}
              disabled={deleting}
              className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? 'deleting…' : 'delete'}
            </button>
          )}
        </div>
      </div>

      {expanded && <InsightsPanel insights={insights} />}
    </div>
  );
}

function InsightsPanel({ insights }: { insights?: BandInsights }) {
  if (!insights) {
    return (
      <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted">
        Loading insights…
      </div>
    );
  }

  const chips: { label: string; value: string }[] = [];
  if (insights.genre) chips.push({ label: 'genre', value: insights.genre });
  if (insights.fee_range) chips.push({ label: 'fee', value: insights.fee_range });
  if (insights.set_length_preference)
    chips.push({ label: 'set', value: insights.set_length_preference });

  const hasAnything =
    chips.length > 0 ||
    !!insights.availability_notes ||
    !!insights.website ||
    insights.social_links.length > 0 ||
    insights.key_facts.length > 0;

  if (!hasAnything) {
    return (
      <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted">
        No insights extracted yet.
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-2 text-[11px]">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c.label}
              className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted"
            >
              <span className="text-muted/70">{c.label}:</span>{' '}
              <span className="text-white/90">{c.value}</span>
            </span>
          ))}
        </div>
      )}
      {insights.availability_notes && (
        <div className="text-muted">
          <span className="text-muted/70">avail:</span> {insights.availability_notes}
        </div>
      )}
      {insights.key_facts.length > 0 && (
        <ul className="list-disc pl-4 text-muted">
          {insights.key_facts.slice(0, 3).map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {(insights.website || insights.social_links.length > 0) && (
        <div className="flex flex-wrap gap-x-2 gap-y-1 text-muted">
          {insights.website && (
            <a
              href={insights.website}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline hover:text-white"
            >
              site
            </a>
          )}
          {insights.social_links.slice(0, 4).map((link, i) => (
            <a
              key={i}
              href={link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline hover:text-white"
            >
              {hostnameOf(link) ?? `link ${i + 1}`}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
