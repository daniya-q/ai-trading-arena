import { generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';

export default async function Setup2FAPage() {
  const secret = generateSecret();
  const otpauth = generateURI({ issuer: 'AI Trading Arena', label: 'admin', secret });
  const qrDataUrl = await QRCode.toDataURL(otpauth, {
    width: 240,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });

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
        overflowY: 'auto',
        padding: '24px',
      }}
    >
      <div
        style={{
          background: '#0B0E17',
          border: '1px solid #1e2433',
          borderRadius: '16px',
          padding: '40px',
          width: '400px',
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#6b7280', letterSpacing: '0.15em', marginBottom: '6px' }}>
            SEASON 1
          </div>
          <h1 style={{ color: '#ffffff', fontSize: '18px', fontWeight: 700, margin: 0 }}>
            AI TRADING ARENA
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '6px', marginBottom: 0 }}>
            Two-Factor Authentication Setup
          </p>
        </div>

        {/* Warning banner */}
        <div
          style={{
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: '10px',
            padding: '12px 16px',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <p style={{ color: '#fbbf24', fontSize: '12px', margin: 0, lineHeight: 1.6 }}>
            <strong>One-time setup.</strong> Scan the QR code once, then copy the secret
            into your Vercel environment variables as <code>TOTP_SECRET</code>.
            Do not refresh this page before scanning.
          </p>
        </div>

        {/* Step 1 */}
        <div style={{ width: '100%' }}>
          <StepLabel n={1} text="Scan with Microsoft Authenticator / Google Authenticator / Authy" />
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              padding: '16px',
              display: 'inline-block',
              marginTop: '12px',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="TOTP QR Code" width={240} height={240} />
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ width: '100%' }}>
          <StepLabel n={2} text="Copy the secret into Vercel → Settings → Environment Variables" />
          <div
            style={{
              marginTop: '12px',
              background: '#131726',
              border: '1px solid #1e2433',
              borderRadius: '10px',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#6b7280', letterSpacing: '0.1em' }}>
              Variable name
            </div>
            <code style={{ color: '#60a5fa', fontSize: '14px', fontWeight: 700 }}>TOTP_SECRET</code>
            <div style={{ fontSize: '11px', color: '#6b7280', letterSpacing: '0.1em', marginTop: '4px' }}>
              Value (backup — for manual entry into authenticator app)
            </div>
            <code
              style={{
                color: '#a78bfa',
                fontSize: '13px',
                wordBreak: 'break-all',
                lineHeight: 1.6,
                fontWeight: 600,
              }}
            >
              {secret}
            </code>
          </div>
        </div>

        {/* Step 3 */}
        <div style={{ width: '100%' }}>
          <StepLabel n={3} text="After setting the env var and redeploying, delete this page" />
          <p style={{ color: '#64748b', fontSize: '12px', margin: '8px 0 0', lineHeight: 1.6 }}>
            Remove <code style={{ color: '#94a3b8' }}>src/app/setup-2fa/</code> from the repo so
            no one else can generate a new QR code.
          </p>
        </div>
      </div>
    </div>
  );
}

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
      <div
        style={{
          minWidth: '22px',
          height: '22px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
          marginTop: '1px',
        }}
      >
        {n}
      </div>
      <p style={{ color: '#cbd5e1', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>{text}</p>
    </div>
  );
}
