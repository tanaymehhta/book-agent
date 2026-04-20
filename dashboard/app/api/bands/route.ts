import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import type { BandRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await query<BandRow>(`
    SELECT
      b.id::text                    AS id,
      b.name                        AS name,
      b.contact_name                AS contact_name,
      b.primary_email               AS primary_email,
      b.status::text                AS status,
      b.on_roster                   AS on_roster,
      b.draft_ready                 AS draft_ready,
      b.needs_review                AS needs_review,
      b.conversation_stage::text    AS conversation_stage,
      b.last_activity_at            AS last_activity_at,
      m.snippet                     AS last_snippet,
      m.direction::text             AS last_direction,
      m.sent_at                     AS last_sent_at
    FROM bands b
    LEFT JOIN LATERAL (
      SELECT mm.snippet, mm.direction, mm.sent_at
      FROM messages mm
      JOIN email_threads t ON t.id = mm.thread_id
      WHERE t.band_id = b.id
      ORDER BY mm.sent_at DESC
      LIMIT 1
    ) m ON TRUE
    WHERE b.status <> 'archived'
    ORDER BY b.last_activity_at DESC NULLS LAST
  `);
  return NextResponse.json({ bands: rows });
}
