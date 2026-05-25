"use client";

import { useEffect, useState } from "react";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

import { useBtcStore } from "@/store/btcStore";

import { startBtcWebSocket } from "@/lib/btc/btcWebSocket";

import { supabase } from "@/lib/supabase/client";

// ── Constants ──────────────────────────────────────────────────

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://ai-trading-arena-backend-production.up.railway.app";

const PER_BOT_CAPITAL = 100_000;

const BOT_CONFIG: Record<string, { name: string; color: string }> = {
  gpt:    { name: "GPT",    color: "#00A67E" },
  claude: { name: "Claude", color: "#CC785C" },
  gemini: { name: "Gemini", color: "#4285F4" },
  groq:   { name: "Groq",   color: "#F55036" },
};

const BOT_IDS = ["gpt", "claude", "gemini", "groq"];

const PLANET_POS: Record<string, { top: number; left: string }> = {
  gpt:    { top: 60,  left: "16%" },
  claude: { top: 60,  left: "84%" },
  gemini: { top: 300, left: "16%" },
  groq:   { top: 300, left: "84%" },
};

// ── Types ──────────────────────────────────────────────────────

type BotCard = {
  botId: string;
  name: string;
  color: string;
  btcCapital: number;
  pnl: number;
  pnlPct: number;
  totalTrades: number;
  winTrades: number;
  winRate: number;
  rank: number;
};

type OpenPosition = {
  id: string;
  botId: string;
  botName: string;
  color: string;
  entryPrice: number;
  entryInr: number;
  btcQuantity: number;
};

type ClosedTrade = {
  id: string;
  botId: string;
  botName: string;
  color: string;
  btcQuantity: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  closedAt: string;
  openedAt: string;
};

type BtcStatus = {
  btcPrice: number;
  btcCandles: number;
  activeBots: number;
};

type EquityPoint = {
  t: string;
  gpt: number;
  claude: number;
  gemini: number;
  groq: number;
};

// ── Color helpers ──────────────────────────────────────────────

function hexToRgb(hex: string) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r
    ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) }
    : { r: 255, g: 255, b: 255 };
}

function lighten(hex: string, amt = 55): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.min(255, r + amt)},${Math.min(255, g + amt)},${Math.min(255, b + amt)})`;
}

function darken(hex: string, amt = 45): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.max(0, r - amt)},${Math.max(0, g - amt)},${Math.max(0, b - amt)})`;
}

// ── Formatters ─────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtINR(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtBTC(n: number): string {
  return n.toFixed(6);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function durationStr(openedAt: string, closedAt: string): string {
  const ms =
    new Date(closedAt).getTime() - new Date(openedAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ── Data fetchers ──────────────────────────────────────────────

async function fetchBotCards(): Promise<BotCard[]> {
  const [capRes, posRes] = await Promise.all([
    supabase
      .from("btc_capital")
      .select("bot_id,allocated_capital,pnl"),
    supabase
      .from("btc_positions")
      .select("bot_id,pnl,status"),
  ]);

  const caps = capRes.data ?? [];
  const allPos = posRes.data ?? [];

  const cards = BOT_IDS.map((id) => {
    const cfg = BOT_CONFIG[id]!;
    const cap = caps.find((c) => c.bot_id === id);
    const closed = allPos.filter(
      (p) => p.bot_id === id && p.status === "CLOSED"
    );
    const winTrades = closed.filter(
      (p) => Number(p.pnl) > 0
    ).length;
    const totalTrades = closed.length;
    const pnl = Number(cap?.pnl ?? 0);
    const btcCapital = Number(cap?.allocated_capital ?? PER_BOT_CAPITAL);
    return {
      botId: id,
      name: cfg.name,
      color: cfg.color,
      btcCapital,
      pnl,
      pnlPct: (pnl / PER_BOT_CAPITAL) * 100,
      totalTrades,
      winTrades,
      winRate: totalTrades > 0 ? winTrades / totalTrades : 0,
      rank: 0,
    };
  });

  cards.sort((a, b) => b.pnl - a.pnl);
  cards.forEach((c, i) => {
    c.rank = i + 1;
  });
  return cards;
}

async function fetchOpenPositions(): Promise<OpenPosition[]> {
  const { data } = await supabase
    .from("btc_positions")
    .select("id,bot_id,entry_price,quantity")
    .eq("status", "OPEN");
  return (data ?? []).map((row) => {
    const cfg = BOT_CONFIG[row.bot_id] ?? {
      name: row.bot_id,
      color: "#fff",
    };
    const entryPrice = Number(row.entry_price);
    const btcQuantity = Number(row.quantity);
    return {
      id: row.id,
      botId: row.bot_id,
      botName: cfg.name,
      color: cfg.color,
      entryPrice,
      entryInr: btcQuantity * entryPrice,  // computed: no separate column
      btcQuantity,
    };
  });
}

async function fetchClosedTrades(): Promise<ClosedTrade[]> {
  const { data } = await supabase
    .from("btc_positions")
    .select(
      "id,bot_id,quantity,entry_price,current_price,pnl,closed_at,opened_at"
    )
    .eq("status", "CLOSED")
    .order("closed_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((row) => {
    const cfg = BOT_CONFIG[row.bot_id] ?? {
      name: row.bot_id,
      color: "#fff",
    };
    return {
      id: row.id,
      botId: row.bot_id,
      botName: cfg.name,
      color: cfg.color,
      btcQuantity: Number(row.quantity),
      entryPrice: Number(row.entry_price),
      exitPrice: Number(row.current_price ?? 0),  // current_price holds exit price after close
      pnl: Number(row.pnl),
      closedAt: row.closed_at ?? "",
      openedAt: row.opened_at ?? "",
    };
  });
}

async function fetchBtcStatus(): Promise<BtcStatus | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/btc/status`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<BtcStatus>;
  } catch {
    return null;
  }
}

// ── Planet card ────────────────────────────────────────────────

function PlanetCard({
  data,
  pos,
}: {
  data: BotCard;
  pos: { top: number; left: string };
}) {
  const { color, name, pnl, pnlPct, totalTrades, winRate } = data;

  return (
    <div
      style={{
        position: "absolute",
        top: pos.top,
        left: pos.left,
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        zIndex: 10,
      }}
    >
      {/* P&L floating above */}
      <p
        className="font-pixel text-[8px] mb-2"
        style={{
          color: pnl >= 0 ? "#22c55e" : "#ef4444",
          animation: "floatUp 3s ease-in-out infinite",
          textShadow:
            pnl >= 0
              ? "0 0 12px rgba(34,197,94,0.6)"
              : "0 0 12px rgba(239,68,68,0.6)",
        }}
      >
        {pnl >= 0 ? "+" : ""}₹{fmtINR(pnl)}
      </p>

      {/* Orbit ring + planet */}
      <div
        style={{
          position: "relative",
          width: 160,
          height: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Spinning orbit ring */}
        <div
          style={{
            position: "absolute",
            width: 160,
            height: 160,
            borderRadius: "50%",
            border: `1px dashed ${color}50`,
            animation: "slowSpin 20s linear infinite",
          }}
        />

        {/* Atmospheric glow */}
        <div
          style={{
            position: "absolute",
            width: 140,
            height: 140,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
            filter: "blur(18px)",
          }}
        />

        {/* Planet */}
        <div
          style={{
            width: 100,
            height: 100,
            borderRadius: "50%",
            background: `radial-gradient(circle at 35% 32%, ${lighten(color)}, ${color} 52%, ${darken(color)})`,
            boxShadow: `0 0 28px ${color}70, 0 0 56px ${color}28`,
            animation: "planetGlow 4s ease-in-out infinite",
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              background: `radial-gradient(circle at 68% 68%, ${darken(color, 60)}60 0%, transparent 55%)`,
            }}
          />
        </div>
      </div>

      {/* Bot name */}
      <p
        className="font-pixel text-[9px] mt-3"
        style={{ color, textShadow: `0 0 12px ${color}80` }}
      >
        {name}
      </p>

      {/* Stats */}
      <div className="flex gap-3 mt-2">
        <p className="font-pixel text-[6px]" style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>
          {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
        </p>
        <p className="font-pixel text-[6px] text-zinc-600">
          {totalTrades}T · {(winRate * 100).toFixed(0)}%W
        </p>
      </div>

      {/* Rank */}
      <p className="font-pixel text-[6px] mt-1 text-zinc-700">
        #{data.rank}
      </p>
    </div>
  );
}

// ── Glass card wrapper ─────────────────────────────────────────

function GlassCard({
  children,
  accent,
  className = "",
}: {
  children: React.ReactNode;
  accent?: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: "rgba(10,10,22,0.72)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: `1px solid ${accent ? `${accent}30` : "rgba(255,255,255,0.06)"}`,
      }}
    >
      {children}
    </div>
  );
}

// ── Table header ───────────────────────────────────────────────

function TableHeader({ cols }: { cols: string[] }) {
  return (
    <div
      className={`grid px-4 pb-2`}
      style={{
        gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {cols.map((h) => (
        <p key={h} className="font-pixel text-[5px] text-zinc-700 tracking-widest">
          {h}
        </p>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function BtcArenaPage() {
  const {
    btcPrice,
    btcChange24h,
    btcHigh24h,
    btcLow24h,
    update24h,
  } = useBtcStore();

  const [botCards, setBotCards] = useState<BotCard[]>([]);
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [btcStatus, setBtcStatus] = useState<BtcStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [equityData, setEquityData] = useState<EquityPoint[]>([]);

  async function refreshCards() {
    const cards = await fetchBotCards();
    setBotCards(cards);

    // Append equity point
    const t = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setEquityData((prev) => {
      const point: EquityPoint = {
        t,
        gpt:    cards.find((c) => c.botId === "gpt")?.btcCapital    ?? PER_BOT_CAPITAL,
        claude: cards.find((c) => c.botId === "claude")?.btcCapital ?? PER_BOT_CAPITAL,
        gemini: cards.find((c) => c.botId === "gemini")?.btcCapital ?? PER_BOT_CAPITAL,
        groq:   cards.find((c) => c.botId === "groq")?.btcCapital   ?? PER_BOT_CAPITAL,
      };
      return [...prev.slice(-59), point];
    });
  }

  async function refreshPositions() {
    const [open, closed] = await Promise.all([
      fetchOpenPositions(),
      fetchClosedTrades(),
    ]);
    setOpenPositions(open);
    setClosedTrades(closed);
    setLastUpdated(new Date());
    setLoading(false);
  }

  async function refreshStatus() {
    const s = await fetchBtcStatus();
    setBtcStatus(s);
  }

  useEffect(() => {
    // Keep existing Binance WebSocket for live price
    startBtcWebSocket();

    // Fetch 24h ticker from Binance REST
    fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT")
      .then((r) => r.json())
      .then((d) => {
        update24h(
          parseFloat(d.priceChangePercent ?? "0"),
          parseFloat(d.highPrice ?? "0"),
          parseFloat(d.lowPrice ?? "0")
        );
      })
      .catch(() => {});

    // Initial load
    Promise.all([refreshCards(), refreshPositions(), refreshStatus()]);

    const cardInterval = setInterval(refreshCards, 30_000);
    const posInterval  = setInterval(refreshPositions, 15_000);
    const statInterval = setInterval(refreshStatus, 30_000);

    return () => {
      clearInterval(cardInterval);
      clearInterval(posInterval);
      clearInterval(statInterval);
    };
  }, []);

  const totalPnL = botCards.reduce((s, b) => s + b.pnl, 0);

  return (
    <div className="flex-1 p-6 min-h-screen text-white fade-in">

      {/* ── Header ────────────────────────────────────────── */}

      <div className="flex items-end justify-between mb-8">

        <div>
          <p className="font-pixel text-[6px] text-orange-500/60 mb-2 tracking-widest">
            BTC ARENA · SEASON 1
          </p>
          <h1 className="font-pixel text-lg text-white mb-2">
            BITCOIN TRADING
          </h1>
          <p className="font-pixel text-[7px] text-zinc-500">
            Autonomous AI bots trading BTC/USDT 24/7
          </p>
        </div>

        {lastUpdated && (
          <p className="font-pixel text-[6px] text-zinc-700">
            UPDATED {lastUpdated.toLocaleTimeString()}
          </p>
        )}

      </div>

      {/* ── BTC Price Hero ─────────────────────────────────── */}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">

        {/* Live price — spans 2 cols */}
        <GlassCard
          accent="#f97316"
          className="lg:col-span-2 p-6 flex flex-col justify-between"
        >
          <p className="font-pixel text-[6px] text-zinc-500 mb-3 tracking-widest">
            BTC / USDT · LIVE
          </p>

          <div>
            <h2
              className="font-pixel text-2xl"
              style={{ color: btcPrice > 0 ? "#f97316" : "#52525b" }}
            >
              {btcPrice > 0 ? `$${fmtUSD(btcPrice)}` : "CONNECTING..."}
            </h2>

            {btcChange24h !== 0 && (
              <p
                className="font-pixel text-[9px] mt-3"
                style={{ color: btcChange24h >= 0 ? "#22c55e" : "#ef4444" }}
              >
                {btcChange24h >= 0 ? "+" : ""}
                {btcChange24h.toFixed(2)}% (24H)
              </p>
            )}
          </div>
        </GlassCard>

        {/* 24h High */}
        <GlassCard className="p-6">
          <p className="font-pixel text-[6px] text-zinc-500 mb-3 tracking-widest">
            24H HIGH
          </p>
          <p className="font-pixel text-[11px] text-green-400">
            {btcHigh24h > 0 ? `$${fmtUSD(btcHigh24h)}` : "--"}
          </p>
        </GlassCard>

        {/* 24h Low */}
        <GlassCard className="p-6">
          <p className="font-pixel text-[6px] text-zinc-500 mb-3 tracking-widest">
            24H LOW
          </p>
          <p className="font-pixel text-[11px] text-red-400">
            {btcLow24h > 0 ? `$${fmtUSD(btcLow24h)}` : "--"}
          </p>
        </GlassCard>

      </div>

      {/* ── Status Bar ─────────────────────────────────────── */}

      <div className="flex items-center gap-4 mb-10 flex-wrap">

        {/* Always open */}
        <span
          className="inline-flex items-center gap-2 font-pixel text-[7px] px-3 py-2"
          style={{
            background: "rgba(34,197,94,0.06)",
            border: "1px solid rgba(34,197,94,0.25)",
            color: "#22c55e",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          MARKET OPEN 24/7
        </span>

        {/* Backend status */}
        {btcStatus !== null && (
          <>
            <span
              className="font-pixel text-[6px] px-3 py-2"
              style={{
                background: "rgba(249,115,22,0.06)",
                border: "1px solid rgba(249,115,22,0.2)",
                color: btcStatus.btcCandles >= 60 ? "#f97316" : "#52525b",
              }}
            >
              {btcStatus.btcCandles >= 60
                ? "▸ TRADING ACTIVE"
                : `▸ WARMING UP ${btcStatus.btcCandles}/60 CANDLES`}
            </span>

            <span className="font-pixel text-[5px] text-zinc-700">
              CANDLES: {btcStatus.btcCandles} · BOTS: {btcStatus.activeBots}
            </span>
          </>
        )}

        {/* Pool PnL */}
        <span
          className="font-pixel text-[6px] ml-auto"
          style={{ color: totalPnL >= 0 ? "#22c55e" : "#ef4444" }}
        >
          POOL P&amp;L: {totalPnL >= 0 ? "+" : ""}₹{fmtINR(totalPnL)}
        </span>

      </div>

      {/* ── Planet Cards ───────────────────────────────────── */}

      <div className="mb-12">

        <p className="font-pixel text-[7px] text-zinc-600 mb-2 tracking-widest text-center">
          ▸ BTC ARENA ◂
        </p>
        <p className="font-pixel text-[6px] text-zinc-700 mb-6 text-center">
          SPOT BTC/USDT · NO MARKET HOURS
        </p>

        <div style={{ position: "relative", minHeight: 520, width: "100%" }}>

          {loading ? (
            <div className="flex items-center justify-center h-[520px]">
              <div className="w-10 h-10 border-2 border-zinc-700 border-t-orange-400 rounded-full animate-spin" />
            </div>
          ) : (
            botCards.map((card) => {
              const pos = PLANET_POS[card.botId];
              if (!pos) return null;
              return (
                <PlanetCard key={card.botId} data={card} pos={pos} />
              );
            })
          )}

        </div>

      </div>

      {/* ── Open BTC Positions ────────────────────────────── */}

      <div className="mb-10">

        <p className="font-pixel text-[7px] text-zinc-600 mb-5 tracking-widest">
          ▸ OPEN BTC POSITIONS
          {openPositions.length > 0 && (
            <span className="text-orange-500/60 ml-3">
              {openPositions.length} ACTIVE
            </span>
          )}
        </p>

        {loading ? (
          <GlassCard className="p-8 flex justify-center">
            <div className="w-7 h-7 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />
          </GlassCard>
        ) : openPositions.length === 0 ? (
          <GlassCard className="p-10 text-center">
            <p className="font-pixel text-[7px] text-zinc-700">
              NO OPEN BTC POSITIONS
            </p>
          </GlassCard>
        ) : (
          <GlassCard className="p-4">

            <TableHeader
              cols={["BOT", "BTC QTY", "ENTRY $", "CURRENT $", "INVESTED ₹", "UNREALISED P&L"]}
            />

            <div className="space-y-1 mt-2">
              {openPositions.map((pos) => {
                const unrealised =
                  btcPrice > 0
                    ? (btcPrice - pos.entryPrice) * pos.btcQuantity
                    : 0;
                return (
                  <div
                    key={pos.id}
                    className="grid px-4 py-3 items-center"
                    style={{
                      gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                      background: `${pos.color}08`,
                      border: `1px solid ${pos.color}18`,
                    }}
                  >
                    <p
                      className="font-pixel text-[8px]"
                      style={{ color: pos.color }}
                    >
                      {pos.botName}
                    </p>
                    <p className="font-pixel text-[7px] text-white">
                      {fmtBTC(pos.btcQuantity)}
                    </p>
                    <p className="font-pixel text-[7px] text-zinc-300">
                      ${fmtUSD(pos.entryPrice)}
                    </p>
                    <p className="font-pixel text-[7px] text-white">
                      {btcPrice > 0 ? `$${fmtUSD(btcPrice)}` : "--"}
                    </p>
                    <p className="font-pixel text-[7px] text-zinc-400">
                      ₹{fmtINR(pos.entryInr)}
                    </p>
                    <p
                      className="font-pixel text-[8px]"
                      style={{
                        color: unrealised >= 0 ? "#22c55e" : "#ef4444",
                      }}
                    >
                      {unrealised >= 0 ? "+" : ""}₹{fmtINR(unrealised)}
                    </p>
                  </div>
                );
              })}
            </div>

          </GlassCard>
        )}

      </div>

      {/* ── Closed BTC Trades ─────────────────────────────── */}

      <div className="mb-10">

        <p className="font-pixel text-[7px] text-zinc-600 mb-5 tracking-widest">
          ▸ CLOSED TRADES
          {closedTrades.length > 0 && (
            <span className="text-zinc-700 ml-3">
              LAST {closedTrades.length}
            </span>
          )}
        </p>

        {loading ? (
          <GlassCard className="p-8 flex justify-center">
            <div className="w-7 h-7 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />
          </GlassCard>
        ) : closedTrades.length === 0 ? (
          <GlassCard className="p-10 text-center">
            <p className="font-pixel text-[7px] text-zinc-700">
              NO CLOSED BTC TRADES YET
            </p>
          </GlassCard>
        ) : (
          <GlassCard className="p-4">

            <TableHeader
              cols={["BOT", "BTC QTY", "ENTRY $", "EXIT $", "P&L ₹", "CLOSED"]}
            />

            <div className="space-y-1 mt-2">
              {closedTrades.map((t) => (
                <div
                  key={t.id}
                  className="grid px-4 py-3 items-center"
                  style={{
                    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                    background: "rgba(255,255,255,0.01)",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <p
                    className="font-pixel text-[8px]"
                    style={{ color: t.color }}
                  >
                    {t.botName}
                  </p>
                  <p className="font-pixel text-[7px] text-zinc-300">
                    {fmtBTC(t.btcQuantity)}
                  </p>
                  <p className="font-pixel text-[7px] text-zinc-400">
                    ${fmtUSD(t.entryPrice)}
                  </p>
                  <p className="font-pixel text-[7px] text-zinc-400">
                    {t.exitPrice > 0 ? `$${fmtUSD(t.exitPrice)}` : "--"}
                  </p>
                  <p
                    className="font-pixel text-[8px]"
                    style={{ color: t.pnl >= 0 ? "#22c55e" : "#ef4444" }}
                  >
                    {t.pnl >= 0 ? "+" : ""}₹{fmtINR(t.pnl)}
                  </p>
                  <div>
                    <p className="font-pixel text-[6px] text-zinc-500">
                      {t.closedAt ? fmtTime(t.closedAt) : "--"}
                    </p>
                    {t.openedAt && t.closedAt && (
                      <p className="font-pixel text-[5px] text-zinc-700 mt-0.5">
                        held {durationStr(t.openedAt, t.closedAt)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

          </GlassCard>
        )}

      </div>

      {/* ── BTC Equity Curve ──────────────────────────────── */}

      <div>

        <p className="font-pixel text-[7px] text-zinc-600 mb-5 tracking-widest">
          ▸ BTC EQUITY CURVE
        </p>

        <div
          style={{
            padding: 16,
            background: "rgba(10,10,22,0.6)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >

          {equityData.length < 2 ? (
            <div className="h-[200px] flex items-center justify-center">
              <p className="font-pixel text-[7px] text-zinc-700 animate-pulse">
                COLLECTING DATA...
              </p>
            </div>
          ) : (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityData}>
                  <XAxis
                    dataKey="t"
                    stroke="#27272a"
                    tick={{
                      fontFamily: "'Press Start 2P', cursive",
                      fontSize: 5,
                      fill: "#52525b",
                    }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="#27272a"
                    tick={{
                      fontFamily: "'Press Start 2P', cursive",
                      fontSize: 5,
                      fill: "#52525b",
                    }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) =>
                      `₹${(v / 1000).toFixed(0)}K`
                    }
                    width={52}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(8,8,20,0.95)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      fontFamily: "'Press Start 2P', cursive",
                      fontSize: 8,
                    }}
                    formatter={(v) => [
                      `₹${Number(v).toLocaleString("en-IN")}`,
                      "",
                    ]}
                  />
                  {BOT_IDS.map((id) => (
                    <Line
                      key={id}
                      type="monotone"
                      dataKey={id}
                      stroke={BOT_CONFIG[id]!.color}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3, fill: BOT_CONFIG[id]!.color }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Legend */}
          <div className="flex gap-6 mt-3 justify-center flex-wrap">
            {BOT_IDS.map((id) => (
              <div key={id} className="flex items-center gap-1.5">
                <div
                  className="w-4 h-px"
                  style={{ backgroundColor: BOT_CONFIG[id]!.color }}
                />
                <p
                  className="font-pixel text-[6px]"
                  style={{ color: BOT_CONFIG[id]!.color }}
                >
                  {BOT_CONFIG[id]!.name}
                </p>
              </div>
            ))}
          </div>

        </div>

      </div>

    </div>
  );
}
