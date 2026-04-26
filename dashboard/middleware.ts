import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

const PUBLIC_PATHS = new Set<string>(['/login', '/api/login', '/api/logout']);

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifySession(cookie);
  if (ok) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Run on every path except Next internals and static files.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
