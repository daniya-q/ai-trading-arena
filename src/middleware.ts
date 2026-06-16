import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = '__auth';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Paths that skip authentication
const PUBLIC_PREFIXES = ['/login', '/api/auth', '/setup-2fa', '/_next', '/static'];
const PUBLIC_EXACT = ['/favicon.ico'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

async function verifySession(value: string, secret: string): Promise<boolean> {
  const dot = value.lastIndexOf('.');
  if (dot === -1) return false;

  const timestamp = value.slice(0, dot);
  const sigB64url = value.slice(dot + 1);

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Date.now() - ts > SESSION_MS) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    // Convert base64url → Uint8Array
    const b64 = sigB64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const sigBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(timestamp));
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const secret = process.env.TOTP_SECRET;

  // No secret configured → setup mode, allow all traffic
  if (!secret) return NextResponse.next();

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;

  if (!sessionCookie) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const valid = await verifySession(sessionCookie, secret);

  if (!valid) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(COOKIE_NAME);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
