"use client";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useBtcStore } from "@/store/btcStore";
import { startBtcWebSocket } from "@/lib/btc/btcWebSocket";
import { supabase } from "@/lib/supabase/client";

const BOT_CONFIG: Record<string, { name: string; color: string }> = {
  gpt:    { name: "GPT-4o",  color: "#00A67E" },
  claude: { name: "Claude",  color: "#CC785C" },
  gemini: { name: "Gemini",  color: "#4285F4" },
  groq:   { name: "Groq",    color: "#F55036" },
};
const BOT_IDS = ["gpt", "claude", "gemini", "groq"];
const USD_TO_INR = 95.82;

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtINR(n: number) {
  return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtTime(iso: string | null) {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("en-IN", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function pnlColor(n: number) {
  if (n === 0) return "#a1a1aa";
  return n > 0 ? "#22c55e" : "#ef4444";
}
function pnlStr(n: number) {
  return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`;
}

type PosRow = {
  id: string;
  bot_id: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  pnl: number;
  charges: number;
  direction: string | null;
  leverage: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  status: "OPEN" | "CLOSED";
  opened_at: string | null;
  closed_at: string | null;
  reasoning?: string;
};

function BtcTradesContent() {
  const searchParams = useSearchParams();
  const initialBot = searchParams.get("bot") ?? "all";
  const { btcPrice } = useBtcStore();
  const [positions, setPositions] = useState<PosRow[]>([]);
  const [activeBot, setActiveBot] = useState(initialBot);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("btc_positions")
      .select("id,bot_id,quantity,entry_price,current_price,pnl,charges,direction,leverage,stop_loss,take_profit,status,opened_at,closed_at,reasoning")
      .order("opened_at", { ascending: false });
    setPositions((data ?? []) as PosRow[]);
  }, []);

  useEffect(() => {
    startBtcWebSocket();
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const filtered = positions.filter(
    p => activeBot === "all" || p.bot_id === activeBot
  );

  return (
    <div className="flex-1 min-h-screen text-white px-6 py-5"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      <div className="mb-5">
        <Link href="/btc" style={{
          fontSize: 13, color: "#a1a1aa", textDecoration: "none"
        }}>
          ← BTC ARENA
        </Link>
        <h1 style={{
          fontSize: 24, fontWeight: 800, marginTop: 8, letterSpacing: "-0.5px"
        }}>
          BTC Trades
        </h1>
        <p style={{ fontSize: 13, color: "#a1a1aa", marginTop: 4 }}>
          All trades with entry/exit, PnL, charges and AI reasoning
        </p>
      </div>

      {/* Bot filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["all", ...BOT_IDS].map(bot => {
          const cfg = bot === "all" ? null : BOT_CONFIG[bot];
          const isActive = activeBot === bot;
          const count = bot === "all"
            ? positions.length
            : positions.filter(p => p.bot_id === bot).length;
          return (
            <button
              key={bot}
              onClick={() => setActiveBot(bot)}
              style={{
                padding: "7px 16px",
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: isActive
                  ? `1px solid ${cfg?.color ?? "#ffffff"}60`
                  : "1px solid rgba(255,255,255,0.08)",
                background: isActive
                  ? `${cfg?.color ?? "#ffffff"}15`
                  : "rgba(255,255,255,0.03)",
                color: isActive ? (cfg?.color ?? "#fff") : "#a1a1aa",
              }}
            >
              {bot === "all" ? "All Bots" : cfg!.name} ({count})
            </button>
          );
        })}
      </div>

      {/* Trade rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 40,
            color: "#6b7280", fontSize: 13 }}>
            No trades yet
          </div>
        )}
        {filtered.map(pos => {
          const cfg = BOT_CONFIG[pos.bot_id]!;
          const isOpen = pos.status === "OPEN";
          const curPrice = isOpen ? btcPrice : pos.current_price;
          const grossPnl = isOpen && btcPrice > 0
            ? (btcPrice - pos.entry_price) * pos.quantity * USD_TO_INR
            : pos.pnl;
          const charges = pos.charges ?? 0;
          const netPnl = grossPnl - charges;
          const isExpanded = expanded === pos.id;

          return (
            <div key={pos.id} style={{
              background: "rgba(10,10,22,0.75)",
              border: `1px solid ${isOpen ? cfg.color + "35" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 10,
              overflow: "hidden",
              backdropFilter: "blur(12px)",
            }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 70px 60px 60px 110px 110px 90px 90px 110px 110px 120px auto",
                  alignItems: "center",
                  padding: "12px 16px",
                  gap: 8,
                  cursor: pos.reasoning ? "pointer" : "default",
                  background: isOpen ? `${cfg.color}06` : "transparent",
                }}
                onClick={() => pos.reasoning &&
                  setExpanded(isExpanded ? null : pos.id)}
              >
                {/* Bot */}
                <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>
                  {cfg.name}
                </span>
                {/* Status */}
                <span style={{
                  fontSize: 11, fontWeight: 600, textAlign: "center",
                  padding: "3px 8px", borderRadius: 4,
                  background: isOpen ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                  color: isOpen ? "#22c55e" : "#a1a1aa",
                  border: isOpen
                    ? "1px solid rgba(34,197,94,0.25)"
                    : "1px solid rgba(255,255,255,0.07)",
                }}>
                  {pos.status}
                </span>
                {/* Direction */}
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: (pos.direction ?? "LONG") === "SHORT" ? "#ef4444" : "#22c55e",
                }}>
                  {pos.direction ?? "LONG"}
                </span>
                {/* Leverage */}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#f97316" }}>
                  {(pos.leverage ?? 1)}x
                </span>
                {/* Entry */}
                <div>
                  <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>Entry</div>
                  <div style={{ fontSize: 13, fontFamily: "monospace" }}>
                    ${fmtUSD(pos.entry_price)}
                  </div>
                </div>
                {/* Exit / Current */}
                <div>
                  <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>
                    {isOpen ? "Current" : "Exit"}
                  </div>
                  <div style={{ fontSize: 13, fontFamily: "monospace",
                    color: isOpen ? "#f97316" : "#a1a1aa" }}>
                    {curPrice > 0 ? `$${fmtUSD(curPrice)}` : "—"}
                  </div>
                </div>
                {/* SL */}
                <div>
                  <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>SL</div>
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: "#ef4444" }}>
                    {pos.stop_loss ? `$${fmtUSD(pos.stop_loss)}` : "—"}
                  </div>
                </div>
                {/* Target */}
                <div>
                  <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>Target</div>
                  <div style={{ fontSize: 12, fontFamily: "monospace", color: "#22c55e" }}>
                    {pos.take_profit ? `$${fmtUSD(pos.take_profit)}` : "—"}
                  </div>
                </div>
                {/* Gross PnL */}
                <div>
                  <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>Gross PnL</div>
                  <div style={{ fontSize: 13, fontFamily: "monospace",
                    fontWeight: 600, color: pnlColor(grossPnl) }}>
                    {pnlStr(grossPnl)}
                  </div>
                </div>
                {/* Net PnL */}
                <div>
                  <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>Net PnL</div>
                  <div style={{ fontSize: 13, fontFamily: "monospace",
                    fontWeight: 700, color: pnlColor(netPnl) }}>
                    {pnlStr(netPnl)}
                  </div>
                  {charges > 0 && (
                    <div style={{ fontSize: 11, color: "#f97316" }}>
                      -₹{fmtINR(charges)} charges
                    </div>
                  )}
                </div>
                {/* Opened */}
                <div>
                  <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 2 }}>Opened</div>
                  <div style={{ fontSize: 11, color: "#a1a1aa" }}>
                    {fmtTime(pos.opened_at)}
                  </div>
                </div>
                {/* Expand */}
                {pos.reasoning && (
                  <span style={{ fontSize: 16, color: "#6b7280" }}>
                    {isExpanded ? "▾" : "▸"}
                  </span>
                )}
              </div>

              {isExpanded && pos.reasoning && (
                <div style={{
                  padding: "12px 16px",
                  borderTop: `1px solid ${cfg.color}15`,
                  background: `${cfg.color}06`,
                }}>
                  <div style={{ fontSize: 11, color: cfg.color,
                    textTransform: "uppercase", letterSpacing: "0.1em",
                    marginBottom: 6, fontWeight: 600 }}>
                    AI Reasoning
                  </div>
                  <p style={{ fontSize: 13, color: "#a1a1aa",
                    lineHeight: 1.7, margin: 0 }}>
                    {pos.reasoning}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BtcTradesPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 p-6 text-white">Loading...</div>
    }>
      <BtcTradesContent />
    </Suspense>
  );
}
