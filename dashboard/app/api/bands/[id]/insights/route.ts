import { NextResponse } from 'next/server';
import { AgentApiError, agentFetch, readAgentJson } from '@/lib/agentApi';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const res = await agentFetch(`/bands/${params.id}/insights`);
    const json = await readAgentJson(res);
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    if (err instanceof AgentApiError) {
      return NextResponse.json(
        { error: err.message, detail: err.detail },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: 'Failed to load insights' }, { status: 500 });
  }
}
