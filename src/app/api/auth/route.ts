import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const COOKIE_NAME = 'auth_token';
const PAYLOAD = 'authenticated';
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days

async function sign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const secret = process.env.SITE_ACCESS_PASSWORD;

  if (!secret || password !== secret) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const signature = await sign(PAYLOAD, secret);
  const cookieValue = `${PAYLOAD}.${signature}`;

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  });
  return response;
}
