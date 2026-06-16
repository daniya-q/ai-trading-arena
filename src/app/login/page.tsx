'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        const next = searchParams.get('next') || '/';
        router.replace(next);
      } else {
        setError('Invalid code. Try again.');
        setCode('');
        inputRef.current?.focus();
      }
    } catch {
      setError('Connection error. Try again.');
    } finally {
      setLoading(false);
    }
  }

  const ready = code.length === 6 && !loading;

  return (
    <form
      onSubmit={handleSubmit}
      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={e => {
          setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
          setError('');
        }}
        placeholder="000000"
        style={{
          width: '100%',
          padding: '14px 8px',
          textAlign: 'center',
          fontSize: '32px',
          fontWeight: 700,
          letterSpacing: '14px',
          background: '#131726',
          border: `1px solid ${error ? '#ef4444' : '#1e2433'}`,
          borderRadius: '10px',
          color: '#e2e8f0',
          outline: 'none',
          boxSizing: 'border-box',
          fontFamily: 'monospace',
          transition: 'border-color 0.15s',
        }}
      />

      {error && (
        <p style={{ color: '#ef4444', fontSize: '13px', textAlign: 'center', margin: 0 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!ready}
        style={{
          padding: '13px',
          background: ready ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' : '#1e2433',
          border: 'none',
          borderRadius: '10px',
          color: ready ? '#ffffff' : '#4a5568',
          fontSize: '15px',
          fontWeight: 600,
          cursor: ready ? 'pointer' : 'not-allowed',
          transition: 'all 0.15s',
          letterSpacing: '0.03em',
        }}
      >
        {loading ? 'Verifying…' : 'Verify'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: '#0A0D14',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          background: '#0B0E17',
          border: '1px solid #1e2433',
          borderRadius: '16px',
          padding: '48px 40px',
          width: '340px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '28px',
        }}
      >
        {/* Branding */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
              borderRadius: '14px',
              margin: '0 auto 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '26px',
            }}
          >
            🔐
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', letterSpacing: '0.15em', marginBottom: '6px' }}>
            SEASON 1
          </div>
          <h1 style={{ color: '#ffffff', fontSize: '18px', fontWeight: 700, margin: 0, letterSpacing: '0.02em' }}>
            AI TRADING ARENA
          </h1>
          <p style={{ color: '#64748b', fontSize: '13px', margin: '8px 0 0' }}>
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
