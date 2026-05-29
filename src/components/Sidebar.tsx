"use client";

import Link from "next/link";

import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "DASHBOARD" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/bots", label: "BOTS" },
  { href: "/trades", label: "TRADES" },
  { href: "/market", label: "MARKET" },
];

const CRYPTO_NAV = [
  { href: "/btc", label: "BTC ARENA" },
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
        className="w-full px-3 py-3 cursor-pointer font-pixel text-[13px] leading-relaxed flex items-center gap-2 transition-colors"
        style={
          isActive
            ? {
                color: accent || "#ffffff",
                background: "rgba(255,255,255,0.04)",
                borderLeft: `2px solid ${accent || "#ffffff"}`,
                paddingLeft: "10px",
              }
            : {
                color: accent ? `${accent}80` : "#a1a1aa",
                borderLeft: "2px solid transparent",
              }
        }
      >
        <span
          style={{
            color: isActive
              ? accent || "#ffffff"
              : "transparent",
          }}
        >
          ▸
        </span>
        {label}
      </div>
    </Link>
  );
}

export default function Sidebar() {

  const pathname = usePathname();

  return (
    <aside
      className="w-64 hidden lg:flex flex-col min-h-screen"
      style={{
        background: "rgba(5,5,15,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >

      {/* Logo */}
      <div className="p-5 border-b border-zinc-900">

        <p className="font-pixel text-[13px] text-zinc-400 mb-2 tracking-widest">
          SEASON 1
        </p>

        <h1 className="font-pixel text-[13px] text-white leading-relaxed">
          AI TRADING
          <br />
          ARENA
        </h1>

      </div>

      {/* Main nav */}
      <div className="flex-1 py-5 px-2 space-y-1">

        <p className="font-pixel text-[13px] text-zinc-300 px-3 mb-3 tracking-widest">
          ── MAIN ──
        </p>

        {NAV.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            pathname={pathname}
          />
        ))}

        <div className="pt-4">

          <p className="font-pixel text-[13px] text-zinc-300 px-3 mb-3 tracking-widest">
            ── CRYPTO ──
          </p>

          {CRYPTO_NAV.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              accent="#f97316"
              pathname={pathname}
            />
          ))}

        </div>

      </div>

      {/* Footer */}
      <div className="p-5 border-t border-zinc-900">
        <p className="font-pixel text-[13px] text-zinc-300 leading-loose">
          AUTONOMOUS AI
          <br />
          HEDGE FUNDS
          <br />
          LIVE MARKETS
        </p>
      </div>

    </aside>
  );
}
