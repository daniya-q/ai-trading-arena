import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'auth_token';
const PAYLOAD = 'authenticated';

async function isValidToken(cookieValue: string, secret: string): Promise<boolean> {
  const dot = cookieValue.lastIndexOf('.');
  if (dot === -1) return false;

  const payload = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);

  if (payload !== PAYLOAD) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expectedSig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expectedHex = Array.from(new Uint8Array(expectedSig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return signature === expectedHex;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow: login page, auth API, Next.js internals
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const secret = process.env.SITE_ACCESS_PASSWORD;

  // If no password configured (e.g. local dev without env var), pass through
  if (!secret) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME);
  if (cookie && (await isValidToken(cookie.value, secret))) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files.
     * The middleware function above handles finer-grained exclusions.
     */
    '/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
