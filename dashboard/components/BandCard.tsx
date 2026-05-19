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
  incompleteProfile?: boolean;
}

export function BandCard({
  band,
  onClick,
  onDelete,
  deleting = false,
  onMove,
  moving = false,
  incompleteProfile = false,
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
        incompleteProfile={incompleteProfile}
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

const STATUS_SHORT_LABELS: Record<BandStatus, string> = {
  incoming: 'incoming',
  in_conversation: 'in conv.',
  approved: 'roster',
  archived: 'archived',
};

function CardActions({
  band,
  onMove,
  moving,
  onDelete,
  deleting,
}: {
  band: BandRow;
  onMove?: (band: BandRow, newStatus: BandStatus) => void;
  moving?: boolean;
  onDelete?: (band: BandRow) => void;
  deleting?: boolean;
}) {
  const next = NEXT_STATUS[band.status];
  const hasMove = !!onMove && !!next;
  const hasDelete = !!onDelete;
  if (!hasMove && !hasDelete) return null;

  return (
    <div
      className="absolute right-2 top-2 z-10 flex items-center gap-0.5"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {hasMove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMove!(band, next!);
          }}
          disabled={moving}
          aria-label={`Move to ${STATUS_SHORT_LABELS[next!]}`}
          title={`Move to ${STATUS_SHORT_LABELS[next!]}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-4 transition hover:bg-paper hover:text-ink-2 disabled:opacity-50"
        >
          {moving ? (
            <span className="text-[11px]">…</span>
          ) : (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8h10" />
              <path d="M9 4l4 4-4 4" />
            </svg>
          )}
        </button>
      )}
      {hasDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete!(band);
          }}
          disabled={deleting}
          aria-label="Delete card"
          title="Delete card"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-4 transition hover:bg-accent-soft/60 hover:text-accent disabled:opacity-50"
        >
          {deleting ? (
            <span className="text-[11px]">…</span>
          ) : (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 4h11" />
              <path d="M6 4V2.5h4V4" />
              <path d="M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4" />
              <path d="M6.5 7v4" />
              <path d="M9.5 7v4" />
            </svg>
          )}
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
  incompleteProfile = false,
}: {
  band: BandRow;
  onClick?: () => void;
  onDelete?: (band: BandRow) => void;
  deleting?: boolean;
  onMove?: (band: BandRow, newStatus: BandStatus) => void;
  moving?: boolean;
  incompleteProfile?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`group relative rounded-xl border bg-paper-2 px-3.5 py-3 shadow-card transition hover:bg-paper-deep hover:shadow-card-hover ${onClick ? 'cursor-pointer' : ''} ${
        incompleteProfile
          ? 'border-amber/60 bg-amber-soft/20 hover:border-amber'
          : 'border-line-strong hover:border-ink/25'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-[600] text-ink">
            {band.name && band.name.trim() ? (
              band.name
            ) : (
              <span className="font-display italic text-ink-3">unnamed band</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-3">
            {band.contact_name ? `${band.contact_name} · ` : ''}
            {band.primary_email}
          </div>
          {incompleteProfile && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-soft/70 px-2 py-0.5 text-[10px] font-[600] text-amber">
              <span className="h-1 w-1 rounded-full bg-amber" />
              incomplete profile — add a band name
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1 mr-14">
          <span className="inline-flex items-center gap-1 rounded-full bg-moss-soft/60 px-2 py-0.5 text-[10px] font-[600] text-moss">
            <span className="h-1 w-1 rounded-full bg-moss" />
            roster
          </span>
          {band.last_direction === 'inbound' && (
            <StatusPill tone="accent" label="needs reply" />
          )}
        </div>
      </div>
      <CardActions
        band={band}
        onMove={onMove}
        moving={moving}
        onDelete={onDelete}
        deleting={deleting}
      />
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
      <CardActions
        band={band}
        onMove={onMove}
        moving={moving}
        onDelete={onDelete}
        deleting={deleting}
      />
      <div
        onClick={onClick}
        className={`px-3.5 pt-3 pb-2.5 ${onClick ? 'cursor-pointer' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 pr-14">
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

          <div className="flex shrink-0 flex-col items-end gap-1 mt-7">
            {band.last_direction === 'inbound' && (
              <StatusPill tone="accent" label="needs reply" />
            )}
            {band.needs_review && <StatusPill tone="accent" label="review" />}
            {band.draft_ready && <StatusPill tone="amber" label="draft" />}
            {awaitingReply && !band.draft_ready && (
              <StatusPill tone="ocean" label="awaiting" />
            )}
          </div>
        </div>

        {band.last_snippet && (
          <p className="mt-2 truncate text-[11.5px] leading-snug text-ink-3">
            {decodeSnippet(band.last_snippet)}
          </p>
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="text-[11px] text-ink-3 transition hover:text-ink"
          >
            {expanded ? 'less' : 'more'}
          </button>
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

function decodeSnippet(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
