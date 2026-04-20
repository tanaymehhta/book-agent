export function agentBaseUrl() {
  return process.env.AGENT_API_URL ?? 'http://localhost:8000';
}

export class AgentApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, message: string, detail = '') {
    super(message);
    this.name = 'AgentApiError';
    this.status = status;
    this.detail = detail;
  }
}

export async function agentFetch(path: string, init?: RequestInit) {
  const base = agentBaseUrl().replace(/\/+$/, '');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reach Agent API';
    throw new AgentApiError(502, 'Agent API unavailable', message);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AgentApiError(res.status, `Agent API ${res.status}`, text || res.statusText);
  }
  return res;
}

export async function readAgentJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { detail: text };
  }
}

