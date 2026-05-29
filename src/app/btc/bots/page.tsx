"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useBtcStore } from "@/store/btcStore";
import { startBtcWebSocket } from "@/lib/btc/btcWebSocket";
import { supabase } from "@/lib/supabase/client";

// ── Constants ─────────────────────────────────────────────────────

const BOT_CONFIG: Record<string, { name: string; color: string }> = {
  gpt:    { name: "GPT",    color: "#00A67E" },
  claude: { name: "Claude", color: "#CC785C" },
  gemini: { name: "Gemini", color: "#4285F4" },
  groq:   { name: "Groq",   color: "#F55036" },
};

const BOT_IDS = ["gpt", "claude", "gemini", "groq"];
const USD_TO_INR = 95.82;

// ── Types ─────────────────────────────────────────────────────────

type CapRow = {
  bot_id: string;
  allocated_capital: number;
  pnl: number;
};

type PosRow = {
  id: string;
  bot_id: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  pnl: number;
  charges: number | null;
  reasoning: string | null;
  status: "OPEN" | "CLOSED";
  opened_at: string | null;
  closed_at: string | null;
};

// ── Formatters ────────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtINR(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtBTC(n: number): string {
  return n.toFixed(6);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("en-IN", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function pnlColor(n: number): string {
  if (n === 0) return "#888888";
  return n > 0 ? "#00ff88" : "#ff4444";
}

function pnlStr(n: number): string {
  return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`;
}

// ── Sharpe Ratio ──────────────────────────────────────────────────

function calcSharpe(closedPos: PosRow[]): string {
  if (closedPos.length < 2) return "—";
  const returns = closedPos.map((p) => p.pnl);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return "—";
  const sharpe = (mean / std) * Math.sqrt(252);
  return sharpe.toFixed(2);
}

// ── Page ──────────────────────────────────────────────────────────

function BtcBotsContent() {
  const { btcPrice, update24h } = useBtcStore();
  const searchParams = useSearchParams();
  const highlightBot = searchParams.get("bot");

  const [caps, setCaps]           = useState<CapRow[]>([]);
  const [positions, setPositions] = useState<PosRow[]>([]);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    const [capRes, posRes] = await Promise.all([
      supabase.from("btc_capital").select("bot_id,allocated_capital,pnl"),
      supabase
        .from("btc_positions")
        .select("id,bot_id,quantity,entry_price,current_price,pnl,charges,reasoning,status,opened_at,closed_at")
        .order("opened_at", { ascending: false }),
    ]);
    if (!capRes.error) setCaps((capRes.data ?? []) as CapRow[]);
    if (!posRes.error) setPositions((posRes.data ?? []) as PosRow[]);
  }, []);

  useEffect(() => {
    startBtcWebSocket();
    fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT")
      .then((r) => r.json())
      .then((d) =>
        update24h(
          parseFloat((d as { priceChangePercent?: string }).priceChangePercent ?? "0"),
          parseFloat((d as { highPrice?: string }).highPrice ?? "0"),
          parseFloat((d as { lowPrice?: string }).lowPrice ?? "0"),
        )
      )
      .catch(() => {});
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh, update24h]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex-1 p-6 min-h-screen text-white fade-in">

      {/* Title */}
      <div className="mb-6">
        <p className="font-pixel text-[6px] text-orange-500/50 mb-2 tracking-widest">
          BTC ARENA · SEASON 1
        </p>
        <h1 className="font-pixel text-lg text-white">
          BOT COMPARISON
        </h1>
      </div>

      {/* 4 bot boxes */}
      <div className="grid grid-cols-4 gap-4 items-start">
        {BOT_IDS.map((botId) => {
          const cfg       = BOT_CONFIG[botId]!;
          const cap       = caps.find((c) => c.bot_id === botId);
          const capital   = cap?.allocated_capital ?? 100_000;
          const pnl       = cap?.pnl ?? 0;
          const retPct    = (pnl / 100_000) * 100;
          const isHighlit = highlightBot === botId;

          const botPos    = positions.filter((p) => p.bot_id === botId);
          const openPos   = botPos.filter((p) => p.status === "OPEN");
          const closedPos = botPos.filter((p) => p.status === "CLOSED");
          const sorted    = [...openPos, ...closedPos];
          const sharpe    = calcSharpe(closedPos);
          const totalCharges = botPos.reduce((s, p) => s + (p.charges ?? 0), 0);

          return (
            <div
              key={botId}
              style={{
                background: "rgba(10,10,22,0.90)",
                border: `1px solid ${isHighlit ? cfg.color + "80" : cfg.color + "30"}`,
                backdropFilter: "blur(12px)",
                boxShadow: isHighlit ? `0 0 24px ${cfg.color}25` : undefined,
              }}
            >
              {/* ── Stats bar ── */}
              <div
                className="px-4 py-4"
                style={{ borderBottom: `1px solid ${cfg.color}15` }}
              >
                {/* Bot name */}
                <div className="flex items-center gap-2 mb-4">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: cfg.color, boxShadow: `0 0 8px ${cfg.color}` }}
                  />
                  <p className="font-pixel font-bold text-[0.9rem]" style={{ color: cfg.color }}>
                    {cfg.name} BOT
                  </p>
                </div>

                {/* Stat rows */}
                {[
                  { label: "TOTAL PNL",  value: pnlStr(pnl),                                      color: pnlColor(pnl),   large: true },
                  { label: "CAPITAL",    value: `₹${fmtINR(capital)}`,                            color: "#ffffff" },
                  { label: "RETURN",     value: `${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%`, color: pnlColor(retPct) },
                  { label: "SHARPE",     value: sharpe,                                            color: "#a78bfa" },
                  { label: "CHARGES",    value: `₹${fmtINR(totalCharges)}`,                       color: "#f59e0b" },
                  { label: "TRADES",     value: `${botPos.length} total · ${openPos.length} open`, color: "#a1a1aa" },
                ].map((row) => (
                  <div key={row.label} className={`flex justify-between items-baseline ${row.large ? "mb-3" : "mb-1.5"}`}>
                    <p className={`font-pixel font-bold tracking-widest text-zinc-500 ${row.large ? "text-[0.65rem]" : "text-[0.55rem]"}`}>
                      {row.label}
                    </p>
                    <p
                      className={`font-pixel font-bold ${row.large ? "text-[1rem]" : "text-[0.75rem]"}`}
                      style={{ color: row.color }}
                    >
                      {row.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* ── Trades table ── */}
              <div className="overflow-y-auto" style={{ maxHeight: "520px" }}>
                {sorted.length === 0 ? (
                  <p className="font-pixel text-[6px] text-zinc-800 text-center py-6">
                    NO TRADES YET
                  </p>
                ) : (
                  <>
                    {/* Column headers */}
                    <div
                      className="grid px-3 py-1.5 font-pixel text-[0.45rem] text-zinc-700 tracking-widest sticky top-0"
                      style={{
                        gridTemplateColumns: "44px 72px 72px 56px 76px 64px 76px 1fr",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        background: "rgba(10,10,22,0.95)",
                      }}
                    >
                      <span>STATUS</span>
                      <span>ENTRY $</span>
                      <span>EXIT $</span>
                      <span>BTC QTY</span>
                      <span>GROSS PNL</span>
                      <span>CHARGES</span>
                      <span>NET PNL</span>
                      <span>REASONING</span>
                    </div>

                    {sorted.map((pos) => {
                      const isOpen       = pos.status === "OPEN";
                      const currentPrice = isOpen ? btcPrice : pos.current_price;
                      const grossPnl     = isOpen && btcPrice > 0
                        ? (btcPrice - pos.entry_price) * pos.quantity * USD_TO_INR
                        : pos.pnl + (pos.charges ?? 0); // estimate gross from net
                      const netPnl       = isOpen
                        ? grossPnl  // live, charges not yet deducted
                        : pos.pnl;
                      const posCharges   = pos.charges ?? 0;
                      const reasonKey    = pos.id;
                      const isExpanded   = expandedReasoning[reasonKey] ?? false;
                      const reasoning    = pos.reasoning ?? "";

                      return (
                        <div
                          key={pos.id}
                          className="grid px-3 py-2 items-start"
                          style={{
                            gridTemplateColumns: "44px 72px 72px 56px 76px 64px 76px 1fr",
                            borderBottom: "1px solid rgba(255,255,255,0.02)",
                            background: isOpen ? `${cfg.color}07` : "transparent",
                          }}
                        >
                          {/* Status */}
                          <span>
                            <span
                              className="font-pixel text-[0.4rem] px-1 py-0.5"
                              style={
                                isOpen
                                  ? { background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }
                                  : { background: "rgba(255,255,255,0.03)", color: "#52525b", border: "1px solid rgba(255,255,255,0.06)" }
                              }
                            >
                              {pos.status}
                            </span>
                          </span>

                          <span className="font-pixel text-[0.5rem] text-zinc-300">
                            ${fmtUSD(pos.entry_price)}
                          </span>

                          <span className="font-pixel text-[0.5rem] text-zinc-500">
                            {currentPrice > 0 ? `$${fmtUSD(currentPrice)}` : "--"}
                          </span>

                          <span className="font-pixel text-[0.5rem] text-zinc-500">
                            {fmtBTC(pos.quantity)}
                          </span>

                          <span className="font-pixel text-[0.5rem]" style={{ color: pnlColor(grossPnl) }}>
                            {pnlStr(grossPnl)}
                          </span>

                          <span className="font-pixel text-[0.5rem] text-amber-500">
                            ₹{fmtINR(posCharges)}
                          </span>

                          <span className="font-pixel text-[0.5rem]" style={{ color: pnlColor(netPnl) }}>
                            {pnlStr(netPnl)}
                          </span>

                          {/* Reasoning */}
                          <span
                            className="font-pixel text-[0.45rem] text-zinc-600 cursor-pointer leading-relaxed"
                            onClick={() =>
                              setExpandedReasoning((prev) => ({ ...prev, [reasonKey]: !prev[reasonKey] }))
                            }
                            title={reasoning}
                          >
                            {reasoning
                              ? isExpanded
                                ? reasoning
                                : reasoning.slice(0, 60) + (reasoning.length > 60 ? "…" : "")
                              : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Opened label */}
              <p className="font-pixel text-[0.4rem] text-zinc-800 text-center py-2">
                {fmtTime(sorted[0]?.opened_at ?? null)} → LATEST
              </p>
            </div>
          );
        })}
      </div>

    </div>
  );
}

export default function BtcBotsPage() {
  return (
    <Suspense fallback={<div className="flex-1 p-6 text-white">Loading...</div>}>
      <BtcBotsContent />
    </Suspense>
  );
}
