import { NextResponse } from 'next/server';
import { AgentApiError, agentFetch, readAgentJson } from '@/lib/agentApi';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await agentFetch('/mailbox');
    const json = await readAgentJson(res);
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    if (err instanceof AgentApiError) {
      return NextResponse.json(
        { error: err.message, detail: err.detail },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: 'Failed to load mailbox' }, { status: 500 });
  }
}
