import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';

function publicOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/login', publicOrigin(req)), { status: 303 });
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
