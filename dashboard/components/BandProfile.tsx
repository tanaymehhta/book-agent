'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import type { BandProfile, SocialLink } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BandProfileViewProps {
  bandId: string;
}

type DraftLink = SocialLink & { _key: string };

type DraftState = {
  name: string;
  contact_name: string;
  w9_name: string;
  bio: string;
  social_links: DraftLink[];
};

let _linkCounter = 0;
const nextKey = () => `link-${++_linkCounter}-${Math.random().toString(36).slice(2, 8)}`;

function toDraft(p: BandProfile): DraftState {
  return {
    name: p.name ?? '',
    contact_name: p.contact_name ?? '',
    w9_name: p.w9_name ?? '',
    bio: p.bio ?? '',
    social_links: p.social_links.map((l) => ({ ...l, _key: nextKey() })),
  };
}

export function BandProfileView({ bandId }: BandProfileViewProps) {
  const { data, error, isLoading, mutate } = useSWR<BandProfile>(
    `/api/bands/${bandId}/profile`,
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: false },
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (justSaved) {
      const t = setTimeout(() => setJustSaved(false), 1800);
      return () => clearTimeout(t);
    }
  }, [justSaved]);

  function startEdit() {
    if (!data) return;
    setDraft(toDraft(data));
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(null);
    setSaveError(null);
    setEditing(false);
  }

  async function saveEdit() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const cleanedLinks: SocialLink[] = draft.social_links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.url.length > 0)
        .map((l) => ({ label: l.label || l.url, url: l.url }));

      const res = await fetch(`/api/bands/${bandId}/profile`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          contact_name: draft.contact_name,
          w9_name: draft.w9_name,
          bio: draft.bio,
          social_links: cleanedLinks,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Save failed');
      await mutate(json as BandProfile, { revalidate: false });
      setDraft(null);
      setEditing(false);
      setJustSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="px-6 pt-12 text-center font-display italic text-[15px] text-ink-4">
        unrolling the profile…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="px-6 pt-12 text-center font-display italic text-[15px] text-accent-deep">
        couldn’t load this profile.
      </div>
    );
  }

  if (editing && draft) {
    const updateDraft = (updater: (d: DraftState) => DraftState) =>
      setDraft((prev) => (prev ? updater(prev) : prev));
    return (
      <EditProfileForm
        draft={draft}
        setDraft={updateDraft}
        onCancel={cancelEdit}
        onSave={saveEdit}
        saving={saving}
        error={saveError}
      />
    );
  }

  return <ReadProfile profile={data} onEdit={startEdit} justSaved={justSaved} />;
}

/* ─────────────────────── READ MODE ─────────────────────── */

function ReadProfile({
  profile,
  onEdit,
  justSaved,
}: {
  profile: BandProfile;
  onEdit: () => void;
  justSaved: boolean;
}) {
  const initials = makeInitials(profile.name, profile.contact_name);
  const w9MatchesName =
    !!profile.w9_name &&
    !!profile.name &&
    profile.w9_name.trim().toLowerCase() === profile.name.trim().toLowerCase();

  return (
    <div className="space-y-7 px-6 pt-6 pb-10">
      <div className="flex items-center justify-end gap-2 -mb-3">
        {justSaved && (
          <span className="fade-up-soft inline-flex items-center gap-1.5 rounded-full bg-moss-soft/70 px-2.5 py-1 text-[10px] font-[600] uppercase tracking-[0.14em] text-moss">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-moss" />
            saved
          </span>
        )}
        <button
          onClick={onEdit}
          className="group inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper-2 px-3 py-1 text-[11px] font-[500] tracking-tight text-ink-2 transition hover:-translate-y-[1px] hover:border-ink/30 hover:bg-paper-deep hover:text-ink"
        >
          <svg
            className="h-3 w-3 text-ink-3 transition group-hover:text-accent"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" />
          </svg>
          Edit
        </button>
      </div>

      {/* ── BAND CREST ─────────────────────────────────────── */}
      <section className="fade-up-soft flex items-center gap-4">
        <div className="relative">
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-accent-soft via-amber-soft to-moss-soft opacity-70 blur-[6px]" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-line-strong bg-paper-2 font-display text-[22px] italic tracking-tight text-ink">
            {initials}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-4">band</div>
          <h3 className="mt-1 truncate text-[22px] font-[600] tracking-[-0.012em] text-ink">
            {profile.name ?? <span className="font-display italic text-ink-4">unnamed</span>}
          </h3>
          {profile.primary_email && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
              {profile.primary_email}
            </div>
          )}
        </div>
        {profile.on_roster && (
          <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-moss/40 bg-moss-soft/60 px-2.5 py-1 text-[10px] font-[600] uppercase tracking-[0.14em] text-moss">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-moss pulse-soft" />
            on roster
          </span>
        )}
      </section>

      {/* ── FACTS ──────────────────────────────────────────── */}
      <section
        className="fade-up-soft grid grid-cols-2 gap-3"
        style={{ animationDelay: '60ms' }}
      >
        <FactCard
          label="primary contact"
          value={profile.contact_name}
          subtle={profile.primary_email}
        />
        <FactCard
          label="w-9 name"
          value={profile.w9_name}
          hint={
            w9MatchesName
              ? 'matches the band name'
              : profile.w9_name
                ? 'legal payee'
                : 'not on file'
          }
          accent={!w9MatchesName && !!profile.w9_name}
        />
      </section>

      {/* ── BIO ────────────────────────────────────────────── */}
      <section className="fade-up-soft space-y-2" style={{ animationDelay: '120ms' }}>
        <SectionLabel>bio</SectionLabel>
        {profile.bio ? (
          <p className="whitespace-pre-wrap rounded-xl border border-line bg-paper-2/60 px-4 py-3 text-[14px] leading-relaxed text-ink-2">
            {profile.bio}
          </p>
        ) : (
          <p className="rounded-xl border border-dashed border-line px-4 py-3 font-display italic text-[14px] text-ink-4">
            no bio yet — click Edit to add one.
          </p>
        )}
      </section>

      {/* ── SOCIAL LINKS ───────────────────────────────────── */}
      <section className="fade-up-soft space-y-2" style={{ animationDelay: '180ms' }}>
        <SectionLabel>social &amp; listening</SectionLabel>
        {profile.social_links.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-3 font-display italic text-[14px] text-ink-4">
            no links yet.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {profile.social_links.map((link, i) => (
              <li
                key={`${link.url}-${i}`}
                className="fade-up-soft"
                style={{ animationDelay: `${200 + i * 50}ms` }}
              >
                <SocialPill link={link} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="pt-2 text-center font-display italic text-[12px] text-ink-4">— fin —</p>
    </div>
  );
}

/* ─────────────────────── EDIT MODE ─────────────────────── */

function EditProfileForm({
  draft,
  setDraft,
  onCancel,
  onSave,
  saving,
  error,
}: {
  draft: DraftState;
  setDraft: (updater: (d: DraftState) => DraftState) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function updateLink(idx: number, field: 'label' | 'url', value: string) {
    setDraft((d) => {
      const links = d.social_links.slice();
      links[idx] = { ...links[idx]!, [field]: value };
      return { ...d, social_links: links };
    });
  }

  function addLink() {
    setDraft((d) => ({
      ...d,
      social_links: [...d.social_links, { label: '', url: '', _key: nextKey() }],
    }));
  }

  function removeLink(idx: number) {
    setDraft((d) => ({
      ...d,
      social_links: d.social_links.filter((_, i) => i !== idx),
    }));
  }

  return (
    <div className="space-y-7 px-6 pt-6 pb-24">
      <section className="fade-up-soft space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            editing profile
          </span>
          <span className="font-display italic text-[12px] text-ink-3">— in pencil</span>
        </div>

        <FieldRow label="band name">
          <TextInput
            value={draft.name}
            onChange={(v) => update('name', v)}
            placeholder="e.g. The Hollow Pines"
            autoFocus
          />
        </FieldRow>

        <FieldRow label="primary contact">
          <TextInput
            value={draft.contact_name}
            onChange={(v) => update('contact_name', v)}
            placeholder="e.g. Margaret Cole"
          />
        </FieldRow>

        <FieldRow
          label="w-9 name"
          hint="the legal payee name — often the band's LLC, sometimes a person."
        >
          <TextInput
            value={draft.w9_name}
            onChange={(v) => update('w9_name', v)}
            placeholder="e.g. Sable Music LLC"
          />
        </FieldRow>
      </section>

      <section className="fade-up-soft space-y-2" style={{ animationDelay: '60ms' }}>
        <SectionLabel>bio</SectionLabel>
        <textarea
          value={draft.bio}
          onChange={(e) => update('bio', e.target.value)}
          placeholder="a sentence or two about the band — sound, scene, what makes a set with them feel like them."
          rows={5}
          className="w-full resize-none rounded-xl border border-line-strong bg-paper px-3.5 py-3 text-[14px] leading-relaxed text-ink placeholder:font-display placeholder:italic placeholder:text-ink-4 focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-accent/20 transition"
        />
      </section>

      <section className="fade-up-soft space-y-2" style={{ animationDelay: '120ms' }}>
        <div className="flex items-center justify-between">
          <SectionLabel>social &amp; listening</SectionLabel>
          <button
            onClick={addLink}
            className="group inline-flex items-center gap-1 rounded-full border border-line-strong bg-paper-2 px-2.5 py-1 text-[11px] font-[500] text-ink-2 transition hover:-translate-y-[1px] hover:border-accent/40 hover:bg-paper-deep hover:text-ink"
          >
            <span className="text-accent transition group-hover:rotate-90">+</span> add link
          </button>
        </div>

        {draft.social_links.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-3 font-display italic text-[14px] text-ink-4">
            no links yet — tap “add link” to drop a Spotify, Bandcamp, IG, etc.
          </p>
        ) : (
          <ul className="space-y-2">
            {draft.social_links.map((link, i) => (
              <li
                key={link._key}
                className="fade-up-soft grid grid-cols-[7rem_1fr_auto] items-center gap-2"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <TextInput
                  value={link.label}
                  onChange={(v) => updateLink(i, 'label', v)}
                  placeholder="label"
                  small
                />
                <TextInput
                  value={link.url}
                  onChange={(v) => updateLink(i, 'url', v)}
                  placeholder="https://"
                  small
                  mono
                />
                <button
                  onClick={() => removeLink(i)}
                  aria-label="Remove link"
                  className="group flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-paper-2 text-ink-3 transition hover:border-accent/50 hover:bg-accent-soft/40 hover:text-accent-deep"
                >
                  <svg
                    className="h-3 w-3 transition group-hover:scale-110"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  >
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── STICKY ACTION BAR ──────────────────────────────── */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10">
        <div className="ml-auto w-[560px] px-6 pb-5">
          <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-line-strong bg-paper/95 px-3 py-2.5 shadow-panel backdrop-blur">
            {error && (
              <span className="flex-1 truncate font-display italic text-[12px] text-accent-deep">
                {error}
              </span>
            )}
            {!error && (
              <span className="flex-1 truncate font-display italic text-[12px] text-ink-3">
                changes pending — nothing saves until you say so.
              </span>
            )}
            <button
              onClick={onCancel}
              disabled={saving}
              className="rounded-full border border-line-strong bg-paper-2 px-3 py-1.5 text-[12px] font-[500] text-ink-2 transition hover:border-ink/30 hover:bg-paper-deep disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-[500] text-paper transition hover:bg-accent disabled:cursor-not-allowed disabled:bg-ink-4"
            >
              {saving ? 'saving…' : 'Save profile'}
              <svg
                className="h-3 w-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 6.5l2.5 2.5 4.5-5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── SHARED BITS ─────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-4">
        {children}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">
        <span>{label}</span>
        {hint && (
          <span className="ml-3 truncate font-display normal-case italic tracking-normal text-[11px] text-ink-3">
            {hint}
          </span>
        )}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  small,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  small?: boolean;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={`w-full rounded-xl border border-line-strong bg-paper px-3.5 ${
        small ? 'py-1.5 text-[13px]' : 'py-2.5 text-[14px]'
      } ${mono ? 'font-mono' : ''} text-ink placeholder:font-display placeholder:italic placeholder:text-ink-4 focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-accent/20 transition`}
    />
  );
}

function FactCard({
  label,
  value,
  subtle,
  hint,
  accent,
}: {
  label: string;
  value: string | null | undefined;
  subtle?: string | null;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-paper-2/70 px-3.5 py-3 transition hover:bg-paper-deep/40 ${
        accent ? 'border-accent/30' : 'border-line-strong'
      }`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-4">{label}</div>
      <div className="mt-1 text-[14px] font-[500] leading-snug text-ink">
        {value ?? <span className="font-display italic text-ink-4">—</span>}
      </div>
      {subtle && <div className="mt-0.5 truncate font-mono text-[10px] text-ink-3">{subtle}</div>}
      {hint && (
        <div
          className={`mt-1 font-display italic text-[11px] ${
            accent ? 'text-accent-deep' : 'text-ink-3'
          }`}
        >
          {hint}
        </div>
      )}
      <span
        className={`pointer-events-none absolute inset-x-3 bottom-0 h-px scale-x-0 transform bg-accent/60 transition-transform duration-300 group-hover:scale-x-100 ${
          accent ? 'group-hover:bg-accent' : ''
        }`}
        style={{ transformOrigin: 'left' }}
      />
    </div>
  );
}

function SocialPill({ link }: { link: SocialLink }) {
  const platform = guessPlatform(link);
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-2 rounded-full border border-line-strong bg-paper px-3 py-1.5 text-[12px] font-[500] text-ink-2 transition hover:-translate-y-[1px] hover:border-ink/35 hover:bg-paper-deep hover:text-ink"
    >
      <span
        className="inline-block h-2 w-2 rounded-full transition group-hover:scale-110"
        style={{ background: platform.color }}
        aria-hidden
      />
      <span className="truncate max-w-[160px]">{link.label}</span>
      <svg
        className="h-3 w-3 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink-2"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 9l6-6M5 3h4v4" />
      </svg>
    </a>
  );
}

function makeInitials(name: string | null, contact: string | null): string {
  const source = name || contact || '';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function guessPlatform(link: SocialLink): { color: string } {
  const u = link.url.toLowerCase();
  const l = link.label.toLowerCase();
  if (u.includes('spotify') || l.includes('spotify')) return { color: '#4a6747' };
  if (u.includes('instagram') || l.includes('instagram') || l === 'ig') return { color: '#b85a3e' };
  if (u.includes('bandcamp') || l.includes('bandcamp')) return { color: '#3b5f76' };
  if (u.includes('youtube') || l.includes('youtube') || u.includes('youtu.be')) return { color: '#8e3f26' };
  if (u.includes('apple.com') || l.includes('apple')) return { color: '#1a1a17' };
  if (u.includes('soundcloud') || l.includes('soundcloud')) return { color: '#b8893a' };
  if (u.includes('tiktok') || l.includes('tiktok')) return { color: '#3a3a34' };
  return { color: '#6f6a61' };
}
