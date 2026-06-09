"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_MAIN = [
  { href: "/", label: "STRATEGIES" },
];

const NAV_CRYPTO = [
  { href: "/btc",        label: "BTC ARENA" },
  { href: "/btc/trades", label: "BTC TRADES" },
];

function NavItem({
  href,
  label,
  accent,
  pathname,
}: {
  href: string;
  label: string;
  accent?: string;
  pathname: string;
}) {
  const isActive = pathname === href;
  return (
    <Link href={href}>
      <div
        style={{
          padding: "10px 16px",
          paddingLeft: isActive ? 14 : 16,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.04em",
          color: isActive
            ? (accent || "#ffffff")
            : (accent ? `${accent}dd` : "#d1d5db"),
          background: isActive ? "rgba(255,255,255,0.05)" : "transparent",
          borderLeft: `2px solid ${isActive ? (accent || "#ffffff") : "transparent"}`,
          transition: "color 0.15s",
        }}
      >
        {label}
      </div>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 200,
        minHeight: "100vh",
        background: "#070A11",
        borderRight: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "20px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ fontSize: 11, color: "#6b7280", letterSpacing: "0.15em", marginBottom: 6 }}>
          SEASON 1
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#ffffff", lineHeight: 1.4 }}>
          AI TRADING
          <br />
          ARENA
        </div>
      </div>

      {/* Main nav */}
      <div style={{ padding: "16px 0 8px" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", letterSpacing: "0.12em", padding: "0 16px", marginBottom: 6, fontWeight: 600 }}>
          STRATEGIES
        </div>
        {NAV_MAIN.map((item) => (
          <NavItem key={item.href} href={item.href} label={item.label} pathname={pathname} />
        ))}
      </div>

      {/* Crypto nav */}
      <div style={{ padding: "8px 0" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", letterSpacing: "0.12em", padding: "0 16px", marginBottom: 6, fontWeight: 600 }}>
          CRYPTO
        </div>
        {NAV_CRYPTO.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            accent="#f97316"
            pathname={pathname}
          />
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "auto",
          padding: "16px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          fontSize: 10,
          color: "#6b7280",
          lineHeight: 1.8,
          letterSpacing: "0.05em",
        }}
      >
        RULE-BASED
        <br />
        STRATEGIES
        <br />
        PAPER TRADING
      </div>
    </aside>
  );
}
