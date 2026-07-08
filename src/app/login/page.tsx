'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.replace('/');
        router.refresh();
      } else {
        setError('Incorrect password.');
        setPassword('');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#0A0D14',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: '#0B0E17',
          border: '1px solid #1E2433',
          borderRadius: '14px',
          padding: '48px 40px',
          width: '100%',
          maxWidth: '380px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Branding */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              fontSize: '22px',
            }}
          >
            ⚡
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#F0F4FF',
              letterSpacing: '-0.4px',
            }}
          >
            AI Trading Arena
          </div>
          <div style={{ color: '#6B7590', fontSize: '13px', marginTop: '6px' }}>
            Enter your password to continue
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
            style={{
              width: '100%',
              padding: '12px 14px',
              backgroundColor: '#141721',
              border: `1px solid ${error ? '#EF4444' : '#1E2433'}`,
              borderRadius: '8px',
              color: '#F0F4FF',
              fontSize: '15px',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
            onFocus={e => {
              if (!error) e.currentTarget.style.borderColor = '#3B82F6';
            }}
            onBlur={e => {
              if (!error) e.currentTarget.style.borderColor = '#1E2433';
            }}
          />

          {error && (
            <div
              style={{
                color: '#EF4444',
                fontSize: '13px',
                marginTop: '8px',
                paddingLeft: '2px',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            style={{
              width: '100%',
              marginTop: '16px',
              padding: '13px',
              backgroundColor: loading || !password.trim() ? '#1A1F2E' : '#3B82F6',
              color: loading || !password.trim() ? '#4A5270' : '#FFFFFF',
              border: 'none',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: loading || !password.trim() ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s, color 0.15s',
              letterSpacing: '0.1px',
            }}
          >
            {loading ? 'Verifying…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
