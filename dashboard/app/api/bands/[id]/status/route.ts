import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import type { BandStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const body = (await req.json().catch(() => null)) as null | { status?: BandStatus };
  const status = body?.status;
  if (!status) return NextResponse.json({ error: 'Missing status' }, { status: 400 });

  const updated = await query<{ id: string; status: string }>(
    `
    UPDATE bands
    SET status = $2::band_status,
        updated_at = NOW()
    WHERE id = $1::uuid
    RETURNING id::text AS id, status::text AS status
    `,
    [params.id, status],
  );

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Band not found' }, { status: 404 });
  }

  return NextResponse.json({ band: updated[0] });
}

