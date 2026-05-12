import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  comparePassword,
  newSessionCookieValue,
} from '@/lib/auth';

export const runtime = 'nodejs';

function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/kanban';
  // Only allow same-origin redirects.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/kanban';
  return raw;
}

function publicOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const params = new URLSearchParams(body);
  const password = params.get('password') ?? '';
  const next = safeNext(params.get('next'));

  const ok = await comparePassword(password);
  const origin = publicOrigin(req);

  if (!ok) {
    const back = new URL('/login', origin);
    back.searchParams.set('next', next);
    back.searchParams.set('error', '1');
    return NextResponse.redirect(back, { status: 303 });
  }

  const value = await newSessionCookieValue();
  const res = NextResponse.redirect(new URL(next, origin), { status: 303 });
  res.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
