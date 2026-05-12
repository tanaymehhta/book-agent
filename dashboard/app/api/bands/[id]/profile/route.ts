import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import type { BandProfile, SocialLink } from '@/lib/types';

export const dynamic = 'force-dynamic';

type ProfileRow = {
  id: string;
  name: string | null;
  contact_name: string | null;
  primary_email: string | null;
  w9_name: string | null;
  bio: string | null;
  social_links: unknown;
  on_roster: boolean;
  status: string | null;
  updated_at: string | null;
};

function parseSocialLinks(raw: unknown): SocialLink[] {
  if (!Array.isArray(raw)) return [];
  const out: SocialLink[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const url = (item as Record<string, unknown>).url;
      const label = (item as Record<string, unknown>).label;
      if (typeof url === 'string' && url.length > 0) {
        out.push({ label: typeof label === 'string' && label ? label : url, url });
      }
    }
  }
  return out;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rows = await query<ProfileRow>(
    `
    SELECT
      b.id::text                    AS id,
      b.name                        AS name,
      b.contact_name                AS contact_name,
      b.primary_email               AS primary_email,
      b.w9_name                     AS w9_name,
      b.bio                         AS bio,
      COALESCE(b.social_links, '[]'::jsonb) AS social_links,
      b.on_roster                   AS on_roster,
      b.status::text                AS status,
      b.updated_at                  AS updated_at
    FROM bands b
    WHERE b.id = $1::uuid
    LIMIT 1
    `,
    [params.id],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Band not found' }, { status: 404 });
  }

  const row = rows[0];
  const profile: BandProfile = {
    id: row.id,
    name: row.name,
    contact_name: row.contact_name,
    primary_email: row.primary_email,
    w9_name: row.w9_name,
    bio: row.bio,
    social_links: parseSocialLinks(row.social_links),
    on_roster: row.on_roster,
    status: row.status,
    updated_at: row.updated_at,
  };

  return NextResponse.json(profile);
}

function nullableTrim(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function sanitizeSocialLinks(raw: unknown): SocialLink[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return [];
  const out: SocialLink[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const url = (item as Record<string, unknown>).url;
    const label = (item as Record<string, unknown>).label;
    if (typeof url !== 'string') continue;
    const trimmedUrl = url.trim();
    if (!trimmedUrl) continue;
    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    out.push({ label: trimmedLabel || trimmedUrl, url: trimmedUrl });
  }
  return out;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: { col: string; val: unknown }[] = [];
  if ('name' in payload) updates.push({ col: 'name', val: nullableTrim(payload.name) });
  if ('contact_name' in payload)
    updates.push({ col: 'contact_name', val: nullableTrim(payload.contact_name) });
  if ('w9_name' in payload) updates.push({ col: 'w9_name', val: nullableTrim(payload.w9_name) });
  if ('bio' in payload) updates.push({ col: 'bio', val: nullableTrim(payload.bio) });
  if ('social_links' in payload) {
    const links = sanitizeSocialLinks(payload.social_links);
    if (links !== undefined) {
      updates.push({ col: 'social_links', val: JSON.stringify(links) });
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  updates.forEach((u, i) => {
    if (u.col === 'social_links') {
      sets.push(`${u.col} = $${i + 1}::jsonb`);
    } else {
      sets.push(`${u.col} = $${i + 1}`);
    }
    values.push(u.val);
  });
  sets.push(`updated_at = now()`);
  values.push(params.id);

  const sql = `
    UPDATE bands
    SET ${sets.join(', ')}
    WHERE id = $${values.length}::uuid
    RETURNING
      id::text AS id,
      name, contact_name, primary_email, w9_name, bio,
      COALESCE(social_links, '[]'::jsonb) AS social_links,
      on_roster, status::text AS status, updated_at
  `;

  const rows = await query<ProfileRow>(sql, values);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Band not found' }, { status: 404 });
  }

  const row = rows[0];
  const profile: BandProfile = {
    id: row.id,
    name: row.name,
    contact_name: row.contact_name,
    primary_email: row.primary_email,
    w9_name: row.w9_name,
    bio: row.bio,
    social_links: parseSocialLinks(row.social_links),
    on_roster: row.on_roster,
    status: row.status,
    updated_at: row.updated_at,
  };
  return NextResponse.json(profile);
}
