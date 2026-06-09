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
          padding: "10px 12px",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.08em",
          color: isActive
            ? (accent || "#ffffff")
            : (accent ? `${accent}70` : "#6b7280"),
          background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
          borderLeft: `2px solid ${isActive ? (accent || "#ffffff") : "transparent"}`,
          paddingLeft: isActive ? 10 : 12,
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
        <div style={{ fontSize: 10, color: "#374151", letterSpacing: "0.15em", marginBottom: 6 }}>
          SEASON 1
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff", lineHeight: 1.4 }}>
          AI TRADING
          <br />
          ARENA
        </div>
      </div>

      {/* Main nav */}
      <div style={{ padding: "16px 4px 8px" }}>
        <div style={{ fontSize: 10, color: "#374151", letterSpacing: "0.15em", padding: "0 12px", marginBottom: 6 }}>
          STRATEGIES
        </div>
        {NAV_MAIN.map((item) => (
          <NavItem key={item.href} href={item.href} label={item.label} pathname={pathname} />
        ))}
      </div>

      {/* Crypto nav */}
      <div style={{ padding: "8px 4px" }}>
        <div style={{ fontSize: 10, color: "#374151", letterSpacing: "0.15em", padding: "0 12px", marginBottom: 6 }}>
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
          color: "#374151",
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
