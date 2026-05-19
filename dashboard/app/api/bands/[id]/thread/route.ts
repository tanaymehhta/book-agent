import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import type { DraftRow, ThreadDetail, ThreadMessageRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const threads = await query<{
    thread_id: string;
    provider: string;
    provider_thread_id: string;
    subject: string | null;
  }>(
    `
    SELECT
      t.id::text        AS thread_id,
      t.provider        AS provider,
      t.provider_thread_id AS provider_thread_id,
      t.subject         AS subject
    FROM email_threads t
    WHERE t.band_id = $1::uuid
    ORDER BY t.last_message_at DESC NULLS LAST, t.first_message_at DESC NULLS LAST
    LIMIT 1
    `,
    [params.id],
  );

  if (threads.length === 0) {
    return NextResponse.json({ error: 'No thread for band yet' }, { status: 404 });
  }

  const thread = threads[0];

  const messages = await query<ThreadMessageRow>(
    `
    SELECT
      m.id::text                    AS id,
      m.direction::text             AS direction,
      m.from_address                AS from_address,
      COALESCE(m.to_addresses, '[]'::jsonb) AS to_addresses,
      m.subject                     AS subject,
      m.body_text                   AS body_text,
      m.snippet                     AS snippet,
      m.sent_at                     AS sent_at
    FROM messages m
    WHERE m.thread_id = $1::uuid
    ORDER BY m.sent_at ASC
    `,
    [thread.thread_id],
  );

  const draftRows = await query<DraftRow & { created_by: string }>(
    `
    SELECT
      d.id::text                  AS id,
      d.provider                  AS provider,
      d.provider_draft_id         AS provider_draft_id,
      d.status::text              AS status,
      d.body_text                 AS body_text,
      d.created_at                AS created_at,
      d.updated_at                AS updated_at,
      d.created_by::text          AS created_by
    FROM drafts d
    WHERE d.thread_id = $1::uuid
      AND d.status = 'pending'
    ORDER BY d.created_at DESC
    LIMIT 1
    `,
    [thread.thread_id],
  );

  const pending_draft = draftRows[0] ?? null;

  const payload: ThreadDetail = {
    thread_id: thread.thread_id,
    provider: thread.provider,
    provider_thread_id: thread.provider_thread_id,
    subject: thread.subject,
    messages,
    pending_draft,
  };

  return NextResponse.json(payload);
}

