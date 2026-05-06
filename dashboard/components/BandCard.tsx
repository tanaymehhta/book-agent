'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { BandInsights, BandRow, BandStatus } from '@/lib/types';
import { daysSince, timeAgo } from '@/lib/format';

const STAGE_LABELS: Record<string, string> = {
  new_lead: 'new lead',
  collecting_details: 'collecting info',
  negotiating_terms: 'negotiating',
  pending_confirmation: 'pending confirm',
  confirmed: 'confirmed',
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BandCardProps {
  band: BandRow;
  onClick?: () => void;
  onDelete?: (band: BandRow) => void;
  deleting?: boolean;
  onMove?: (band: BandRow, newStatus: BandStatus) => void;
  moving?: boolean;
}

export function BandCard({
  band,
  onClick,
  onDelete,
  deleting = false,
  onMove,
  moving = false,
}: BandCardProps) {
  if (band.status === 'approved') {
    return (
      <ApprovedCard
        band={band}
        onClick={onClick}
        onDelete={onDelete}
        deleting={deleting}
        onMove={onMove}
        moving={moving}
      />
    );
  }
  return (
    <FullCard
      band={band}
      onClick={onClick}
      onDelete={onDelete}
      deleting={deleting}
      onMove={onMove}
      moving={moving}
    />
  );
}

const NEXT_STATUS: Record<BandStatus, BandStatus | null> = {
  incoming: 'in_conversation',
  in_conversation: 'approved',
  approved: null,
  archived: null,
};

const PREV_STATUS: Record<BandStatus, BandStatus | null> = {
  incoming: null,
  in_conversation: 'incoming',
  approved: 'in_conversation',
  archived: null,
};

const STATUS_SHORT_LABELS: Record<BandStatus, string> = {
  incoming: 'incoming',
  in_conversation: 'in conv.',
  approved: 'roster',
  archived: 'archived',
};

function MoveControls({
  band,
  onMove,
  moving,
  variant,
}: {
  band: BandRow;
  onMove?: (band: BandRow, newStatus: BandStatus) => void;
  moving?: boolean;
  variant: 'inline' | 'overlay';
}) {
  if (!onMove) return null;
  const next = NEXT_STATUS[band.status];
  const prev = PREV_STATUS[band.status];
  if (!next && !prev) return null;

  const baseBtn =
    variant === 'overlay'
      ? 'rounded-full border border-line-strong bg-paper px-2 py-0.5 text-[10px] font-[500] text-ink-3 transition hover:border-ink/30 hover:text-ink-2 disabled:opacity-50'
      : 'text-[11px] font-[500] text-ink-3 transition hover:text-ink-2 disabled:opacity-50';

  return (
    <div className={variant === 'overlay' ? 'flex items-center gap-1.5' : 'flex items-center gap-2'}>
      {prev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMove(band, prev);
          }}
          disabled={moving}
          className={baseBtn}
          title={`Move back to ${STATUS_SHORT_LABELS[prev]}`}
        >
          {moving ? '…' : `← ${STATUS_SHORT_LABELS[prev]}`}
        </button>
      )}
      {next && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMove(band, next);
          }}
          disabled={moving}
          className={baseBtn}
          title={`Move forward to ${STATUS_SHORT_LABELS[next]}`}
        >
          {moving ? '…' : `${STATUS_SHORT_LABELS[next]} →`}
        </button>
      )}
    </div>
  );
}

function ApprovedCard({
  band,
  onClick,
  onDelete,
  deleting,
  onMove,
  moving,
}: {
  band: BandRow;
  onClick?: () => void;
  onDelete?: (band: BandRow) => void;
  deleting?: boolean;
  onMove?: (band: BandRow, newStatus: BandStatus) => void;
  moving?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`group relative rounded-xl border border-line-strong bg-paper-2 px-3.5 py-3 shadow-card transition hover:border-ink/25 hover:bg-paper-deep hover:shadow-card-hover ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-[600] text-ink">
            {band.name ?? <span className="font-display italic text-ink-3">unknown</span>}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-3">
            {band.contact_name ? `${band.contact_name} · ` : ''}
            {band.primary_email}
          </div>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-moss-soft/60 px-2 py-0.5 text-[10px] font-[600] text-moss">
          <span className="h-1 w-1 rounded-full bg-moss" />
          roster
        </span>
      </div>
      <div className="absolute right-2 top-2 flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
        <MoveControls band={band} onMove={onMove} moving={moving} variant="overlay" />
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(band);
            }}
            disabled={deleting}
            className="text-[10px] font-[500] text-ink-4 transition hover:text-accent disabled:opacity-50"
          >
            {deleting ? '…' : 'remove'}
          </button>
        )}
      </div>
    </div>
  );
}

function FullCard({
  band,
  onClick,
  onDelete,
  deleting,
  onMove,
  moving,
}: {
  band: BandRow;
  onClick?: () => void;
  onDelete?: (band: BandRow) => void;
  deleting?: boolean;
  onMove?: (band: BandRow, newStatus: BandStatus) => void;
  moving?: boolean;
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
      className={`group relative rounded-xl border border-line-strong bg-paper-2 shadow-card transition hover:border-ink/25 hover:shadow-card-hover ${stale ? 'opacity-55' : ''}`}
    >
      <div
        onClick={onClick}
        className={`px-3.5 pt-3 pb-2.5 ${onClick ? 'cursor-pointer' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-[600] tracking-[-0.005em] text-ink">
              {band.name ?? <span className="font-display italic text-ink-3">unknown</span>}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-ink-3">
              {band.primary_email}
              {band.contact_name && (
                <span className="text-ink-4"> · {band.contact_name}</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            {band.needs_review && <StatusPill tone="accent" label="review" />}
            {band.draft_ready && <StatusPill tone="amber" label="draft" />}
            {awaitingReply && !band.draft_ready && (
              <StatusPill tone="ocean" label="awaiting" />
            )}
          </div>
        </div>

        {band.last_snippet && (
          <div className="mt-2.5">
            <p className="line-clamp-2 font-display text-[14px] italic leading-snug text-ink-2">
              <span className="mr-1 not-italic font-sans text-[10px] font-[600] uppercase tracking-[0.14em] text-ink-4">
                {band.last_direction === 'outbound' ? 'you' : 'them'}
              </span>
              &ldquo;{band.last_snippet}&rdquo;
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-ink-4" />
          {timeAgo(band.last_activity_at)}
        </span>
        <div className="flex items-center gap-2">
          {band.conversation_stage && (
            <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-[500] text-ink-2">
              {STAGE_LABELS[band.conversation_stage] ?? band.conversation_stage}
            </span>
          )}
          <MoveControls band={band} onMove={onMove} moving={moving} variant="inline" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="text-[11px] text-ink-3 transition hover:text-ink"
          >
            {expanded ? 'less' : 'more'}
          </button>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(band);
              }}
              disabled={deleting}
              className="text-[11px] text-ink-4 transition hover:text-accent disabled:opacity-50"
            >
              {deleting ? '…' : 'remove'}
            </button>
          )}
        </div>
      </div>

      {expanded && <InsightsPanel insights={insights} />}
    </div>
  );
}

function StatusPill({
  tone,
  label,
}: {
  tone: 'accent' | 'amber' | 'ocean';
  label: string;
}) {
  const styles: Record<string, string> = {
    accent: 'bg-accent-soft/70 text-accent-deep',
    amber: 'bg-amber-soft/70 text-amber',
    ocean: 'bg-ocean-soft/70 text-ocean',
  };
  const dots: Record<string, string> = {
    accent: 'bg-accent',
    amber: 'bg-amber',
    ocean: 'bg-ocean',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-[600] ${styles[tone]}`}
    >
      <span className={`h-1 w-1 rounded-full ${dots[tone]}`} />
      {label}
    </span>
  );
}

function InsightsPanel({ insights }: { insights?: BandInsights }) {
  if (!insights) {
    return (
      <div className="border-t border-line bg-paper/60 px-3.5 py-2 font-display text-[13px] italic text-ink-3">
        gathering notes…
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
      <div className="border-t border-line bg-paper/60 px-3.5 py-2 font-display text-[13px] italic text-ink-3">
        no notes yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-line bg-paper/60 px-3.5 py-3">
      <div className="font-display text-[11px] italic text-ink-4">— notes —</div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-paper px-2 py-0.5 text-[11px]"
            >
              <span className="text-ink-4">{c.label}</span>
              <span className="text-ink">{c.value}</span>
            </span>
          ))}
        </div>
      )}
      {insights.availability_notes && (
        <div className="text-[12px] text-ink-2">
          <span className="font-[600] text-ink-4">availability · </span>
          <span className="font-display italic">{insights.availability_notes}</span>
        </div>
      )}
      {insights.key_facts.length > 0 && (
        <ul className="space-y-1">
          {insights.key_facts.slice(0, 3).map((f, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-ink-2">
              <span className="text-accent">·</span>
              <span className="font-display italic leading-snug">{f}</span>
            </li>
          ))}
        </ul>
      )}
      {(insights.website || insights.social_links.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {insights.website && (
            <a
              href={insights.website}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-ink-2 underline decoration-line-strong underline-offset-2 transition hover:text-accent hover:decoration-accent"
            >
              site ↗
            </a>
          )}
          {insights.social_links.slice(0, 4).map((link, i) => (
            <a
              key={i}
              href={link}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-ink-2 underline decoration-line-strong underline-offset-2 transition hover:text-accent hover:decoration-accent"
            >
              {hostnameOf(link) ?? `link ${i + 1}`} ↗
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
