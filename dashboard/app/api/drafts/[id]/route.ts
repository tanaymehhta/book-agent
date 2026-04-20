import { NextResponse } from 'next/server';
import { AgentApiError, agentFetch, readAgentJson } from '@/lib/agentApi';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const body = await req.json().catch(() => null);
  if (!body?.body_text) {
    return NextResponse.json({ error: 'Missing body_text' }, { status: 400 });
  }

  try {
    const res = await agentFetch(`/drafts/${params.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body_text: body.body_text }),
    });

    const json = await readAgentJson(res);
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    if (err instanceof AgentApiError) {
      return NextResponse.json(
        { error: err.message, detail: err.detail },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: 'Failed to update draft' }, { status: 500 });
  }
}

