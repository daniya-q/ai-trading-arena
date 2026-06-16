import { NextRequest, NextResponse } from 'next/server';
import { verifySync } from 'otplib';
import crypto from 'crypto';

const COOKIE_NAME = '__auth';
const SESSION_DAYS = 7;

function signSession(secret: string): string {
  const timestamp = String(Date.now());
  const sig = crypto
    .createHmac('sha256', secret)
    .update(timestamp)
    .digest('base64url');
  return `${timestamp}.${sig}`;
}

export async function POST(request: NextRequest) {
  const secret = process.env.TOTP_SECRET;

  if (!secret) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  let code: string;
  try {
    const body = await request.json();
    code = String(body.code ?? '').replace(/\D/g, '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (code.length !== 6) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
  }

  const result = verifySync({ token: code, secret });
  const isValid = result.valid;

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
  }

  const sessionValue = signSession(secret);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: '/',
  });

  return response;
}
