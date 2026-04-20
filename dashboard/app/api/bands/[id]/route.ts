import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const deleted = await query<{ id: string }>(
      `
      DELETE FROM bands
      WHERE id = $1::uuid
      RETURNING id::text AS id
      `,
      [params.id],
    );

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Band not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: deleted[0].id });
  } catch {
    return NextResponse.json({ error: 'Failed to delete band' }, { status: 500 });
  }
}
