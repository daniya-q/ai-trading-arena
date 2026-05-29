"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

import { supabase } from "@/lib/supabase/client";

import { bots } from "@/data/bots";

import { useCapitalStore } from "@/store/capitalStore";

import { usePositionStore } from "@/store/positionStore";

import { useAIMemoryStore } from "@/store/aiMemoryStore";

import { startLiveAITrading } from "@/lib/agents/liveTradingAgent";

import {
  startMarketWebSocket,
  startRestPolling,
} from "@/lib/upstox/startMarketWebSocket";

// ── Constants ─────────────────────────────────────────────────

const INITIAL_CAPITAL = 400000;

const PER_BOT_CAPITAL = 100000;

const BOT_CONFIG: Record<string, { name: string; color: string }> = {
  gpt: { name: "GPT", color: "#00A67E" },
  claude: { name: "Claude", color: "#CC785C" },
  gemini: { name: "Gemini", color: "#4285F4" },
  groq: { name: "Groq", color: "#F55036" },
};

// Solar system positions (top + left percentages, centered via translateX)
const PLANET_POS: Record<
  string,
  { top?: number; bottom?: number; left: string }
> = {
  gpt: { top: 60, left: "16%" },
  claude: { top: 60, left: "84%" },
  gemini: { top: 320, left: "16%" },
  groq: { top: 320, left: "84%" },
};

// ── Types ─────────────────────────────────────────────────────

type BotCardData = {
  botId: string;
  botName: string;
  color: string;
  rank: number;
  allocatedCapital: number;
  pnl: number;
  winRate: number;
  sharpeLike: number;
  totalTrades: number;
  openSymbol: string | null;
  carrySymbol: string | null;
};

// ── Color helpers ──────────────────────────────────────────────

function hexToRgb(hex: string) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r
    ? {
        r: parseInt(r[1], 16),
        g: parseInt(r[2], 16),
        b: parseInt(r[3], 16),
      }
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

// ── IST helpers ────────────────────────────────────────────────

function getISTDate(): Date {
  const now = new Date();
  return new Date(
    now.getTime() +
      now.getTimezoneOffset() * 60000 +
      5.5 * 60 * 60 * 1000
  );
}

function getTodayMarketOpenUTC(): Date {
  const ist = getISTDate();
  const o = new Date(ist);
  o.setHours(9, 15, 0, 0);
  return new Date(o.getTime() - 5.5 * 60 * 60 * 1000);
}

function getMarketStatus(): {
  isOpen: boolean;
  timeUntilOpen: string;
} {
  const ist = getISTDate();
  const day = ist.getDay();
  const total = ist.getHours() * 60 + ist.getMinutes();
  const open = 9 * 60 + 15;
  const close = 15 * 60 + 30;
  const weekday = day >= 1 && day <= 5;
  const isOpen = weekday && total >= open && total < close;

  if (isOpen) return { isOpen: true, timeUntilOpen: "" };

  let mins = 0;
  if (weekday && total < open) {
    mins = open - total;
  } else {
    const ahead =
      day === 5 && total >= close ? 3 : day === 6 ? 2 : 1;
    mins =
      24 * 60 - total + (ahead - 1) * 24 * 60 + open;
  }

  const d = Math.floor(mins / (24 * 60));
  const h = Math.floor((mins % (24 * 60)) / 60);
  const m = mins % 60;
  let s = "";
  if (d > 0) s += `${d}d `;
  if (h > 0 || d > 0) s += `${h}h `;
  s += `${m}m`;
  return { isOpen: false, timeUntilOpen: s.trim() };
}

// ── Data fetcher ───────────────────────────────────────────────

async function fetchBotCardData(): Promise<BotCardData[]> {
  const todayOpen = getTodayMarketOpenUTC();

  const [capRes, openRes, allRes] = await Promise.all([
    supabase.from("capital").select("*"),
    supabase
      .from("positions")
      .select("bot_id, symbol, opened_at")
      .eq("status", "OPEN"),
    supabase.from("positions").select("bot_id"),
  ]);

  const counts: Record<string, number> = {};
  (allRes.data || []).forEach((r) => {
    counts[r.bot_id] = (counts[r.bot_id] || 0) + 1;
  });

  const openPos = openRes.data || [];
  const capital = capRes.data || [];

  const data = bots.map((bot) => {
    const cap = capital.find((c) => c.bot_id === bot.id);
    const botOpen = openPos.filter((p) => p.bot_id === bot.id);
    const carry = botOpen.find(
      (p) => new Date(p.opened_at) < todayOpen
    );
    const cfg = BOT_CONFIG[bot.id] ?? {
      name: bot.id,
      color: "#fff",
    };
    return {
      botId: bot.id,
      botName: cfg.name,
      color: cfg.color,
      rank: 0,
      allocatedCapital:
        Number(cap?.allocated_capital) || PER_BOT_CAPITAL,
      pnl: Number(cap?.pnl) || 0,
      winRate: Number(cap?.win_rate) || 0,
      sharpeLike: Number(cap?.sharpe_like) || 0,
      totalTrades: counts[bot.id] || 0,
      openSymbol: botOpen[0]?.symbol ?? null,
      carrySymbol: carry?.symbol ?? null,
    };
  });

  data.sort((a, b) => b.pnl - a.pnl);
  data.forEach((d, i) => {
    d.rank = i + 1;
  });
  return data;
}

// ── Planet node ────────────────────────────────────────────────

function PlanetNode({
  data,
  pos,
  onClick,
}: {
  data: BotCardData;
  pos: { top?: number; bottom?: number; left: string };
  onClick: () => void;
}) {
  const { color, botName, pnl } = data;
  const posStyle: React.CSSProperties = {
    position: "absolute",
    left: pos.left,
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    cursor: "pointer",
    zIndex: 10,
  };
  if (pos.top !== undefined) posStyle.top = pos.top;
  if (pos.bottom !== undefined) posStyle.bottom = pos.bottom;

  return (
    <div style={posStyle} onClick={onClick}>

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
        {pnl >= 0 ? "+" : ""}₹
        {Math.abs(pnl).toLocaleString("en-IN")}
      </p>

      {/* Orbit ring + planet */}
      <div
        style={{
          position: "relative",
          width: 180,
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >

        {/* Spinning orbit ring */}
        <div
          style={{
            position: "absolute",
            width: 180,
            height: 180,
            borderRadius: "50%",
            border: `1px dashed ${color}50`,
            animation: "slowSpin 20s linear infinite",
          }}
        />

        {/* Atmospheric glow (static, behind planet) */}
        <div
          style={{
            position: "absolute",
            width: 160,
            height: 160,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
            filter: "blur(18px)",
          }}
        />

        {/* Planet */}
        <div
          className="group-hover:scale-110"
          style={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: `radial-gradient(circle at 35% 32%, ${lighten(color)}, ${color} 52%, ${darken(color)})`,
            boxShadow: `0 0 28px ${color}70, 0 0 56px ${color}28`,
            animation: "planetGlow 4s ease-in-out infinite",
            transition: "transform 0.25s ease",
            zIndex: 2,
          }}
        >
          {/* Surface shading overlay */}
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

      {/* Bot name below */}
      <p
        className="font-pixel text-[9px] mt-3"
        style={{ color, textShadow: `0 0 12px ${color}80` }}
      >
        {botName}
      </p>

      {/* Rank */}
      <p
        className="font-pixel text-[6px] mt-1 text-zinc-600"
      >
        #{data.rank}
      </p>

    </div>
  );
}

// ── Planet expanded overlay ────────────────────────────────────

function PlanetOverlay({
  data,
  onClose,
}: {
  data: BotCardData;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { color, botName, pnl, winRate, totalTrades,
          allocatedCapital, openSymbol, carrySymbol } = data;

  const pctReturn = ((pnl / PER_BOT_CAPITAL) * 100).toFixed(2);
  const capitalPct = (allocatedCapital / PER_BOT_CAPITAL) * 100;
  const barColor = allocatedCapital >= PER_BOT_CAPITAL ? "#22c55e" : "#ef4444";

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth: 440,
          width: "90%",
          padding: "28px",
          background: "rgba(8,8,20,0.96)",
          border: `2px solid ${color}`,
          boxShadow: `0 0 60px ${color}30`,
          animation: "scaleIn 0.2s ease-out",
        }}
      >

        {/* Corner squares */}
        {[
          { top: -4, left: -4 },
          { top: -4, right: -4 },
          { bottom: -4, left: -4 },
          { bottom: -4, right: -4 },
        ].map((pos, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: 8,
              height: 8,
              backgroundColor: color,
              ...pos,
            }}
          />
        ))}

        {/* Close */}
        <button
          onClick={onClose}
          className="font-pixel text-[9px] text-zinc-500 hover:text-white transition-colors"
          style={{ position: "absolute", top: 12, right: 14 }}
        >
          [X]
        </button>

        {/* Bot name */}
        <h2
          className="font-pixel text-sm mb-6"
          style={{
            color,
            textShadow: `0 0 20px ${color}80`,
          }}
        >
          {botName}
        </h2>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 mb-6">

          <div>
            <p className="font-pixel text-[6px] text-zinc-500 mb-1">
              P&amp;L
            </p>
            <p
              className="font-pixel text-[11px]"
              style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}
            >
              {pnl >= 0 ? "+" : ""}₹
              {Math.abs(pnl).toLocaleString("en-IN")}
            </p>
          </div>

          <div>
            <p className="font-pixel text-[6px] text-zinc-500 mb-1">
              RETURN
            </p>
            <p
              className="font-pixel text-[11px]"
              style={{
                color:
                  Number(pctReturn) >= 0 ? "#22c55e" : "#ef4444",
              }}
            >
              {Number(pctReturn) >= 0 ? "+" : ""}
              {pctReturn}%
            </p>
          </div>

          <div>
            <p className="font-pixel text-[6px] text-zinc-500 mb-1">
              TRADES
            </p>
            <p className="font-pixel text-[11px] text-white">
              {totalTrades}
            </p>
          </div>

          <div>
            <p className="font-pixel text-[6px] text-zinc-500 mb-1">
              WIN RATE
            </p>
            <p className="font-pixel text-[11px] text-white">
              {(winRate * 100).toFixed(1)}%
            </p>
          </div>

          <div>
            <p className="font-pixel text-[6px] text-zinc-500 mb-1">
              OPEN
            </p>
            <p
              className="font-pixel text-[9px]"
              style={{
                color: openSymbol ? color : "#52525b",
              }}
            >
              {openSymbol ?? "NONE"}
            </p>
          </div>

          <div>
            <p className="font-pixel text-[6px] text-zinc-500 mb-1">
              CARRY
            </p>
            <p
              className="font-pixel text-[9px]"
              style={{
                color: carrySymbol ? "#f59e0b" : "#52525b",
              }}
            >
              {carrySymbol ?? "NONE"}
            </p>
          </div>

        </div>

        {/* Capital bar */}
        <div className="mb-6">
          <div className="flex justify-between mb-1">
            <p className="font-pixel text-[6px] text-zinc-500">
              CAPITAL
            </p>
            <p
              className="font-pixel text-[6px]"
              style={{ color: barColor }}
            >
              {capitalPct.toFixed(0)}%
            </p>
          </div>
          <div
            className="w-full h-2"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.min(capitalPct, 100)}%`,
                backgroundColor: barColor,
              }}
            />
          </div>
        </div>

        {/* View full details */}
        <Link href="/bots">
          <p
            className="font-pixel text-[8px] hover:underline transition-colors"
            style={{ color }}
          >
            VIEW FULL DETAILS →
          </p>
        </Link>

      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function Home() {

  const { capitals } = useCapitalStore();

  const [botCards, setBotCards] =
    useState<BotCardData[]>([]);

  const [selected, setSelected] =
    useState<string | null>(null);

  const [equityData, setEquityData] =
    useState<{ t: string; v: number }[]>([]);

  const [marketStatus, setMarketStatus] =
    useState(getMarketStatus);

  const [mounted, setMounted] = useState(false);

  const totalCapital = capitals.reduce(
    (s, b) => s + b.allocatedCapital,
    0
  );
  const totalPnL = capitals.reduce((s, b) => s + b.pnl, 0);
  const totalPnLPct = (
    (totalPnL / INITIAL_CAPITAL) *
    100
  ).toFixed(2);

  async function refreshBotCards() {
    const data = await fetchBotCardData();
    setBotCards(data);
  }

  useEffect(() => {
    setMounted(true);

    Promise.all([
      useCapitalStore
        .getState()
        .initializeBots(bots.map((b) => b.id)),
      usePositionStore.getState().loadFromSupabase(),
      useAIMemoryStore.getState().loadFromSupabase(),
    ]).then(() => startLiveAITrading());

    startMarketWebSocket();
    startRestPolling();
    refreshBotCards();

    const eq = setInterval(() => {
      const caps = useCapitalStore.getState().capitals;
      const total = caps.reduce(
        (s, b) => s + b.allocatedCapital,
        0
      );
      if (total > 0) {
        setEquityData((prev) => [
          ...prev.slice(-59),
          {
            t: new Date().toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            v: total,
          },
        ]);
      }
    }, 3000);

    const cards = setInterval(refreshBotCards, 30000);

    const status = setInterval(() => {
      setMarketStatus(getMarketStatus());
    }, 30000);

    return () => {
      clearInterval(eq);
      clearInterval(cards);
      clearInterval(status);
    };
  }, []);

  if (!mounted) return null;

  const leader = botCards[0];
  const selectedData = botCards.find(
    (b) => b.botId === selected
  );

  return (
    <div className="flex-1 p-6 min-h-screen text-white fade-in">

      {/* ── Section 1: Competition Header ─────────────────── */}

      <div
        className="mb-10 p-6"
        style={{
          border: "2px dashed rgba(255,255,255,0.08)",
          background: "rgba(10,10,22,0.55)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >

        <div className="text-center mb-6">
          <h1 className="font-pixel text-lg text-white mb-2">
            SEASON 1
          </h1>
          <p className="font-pixel text-[9px] text-zinc-400 tracking-widest">
            AI TRADING ARENA
          </p>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-6 mb-6">

          <div className="text-center">
            <p className="font-pixel text-[6px] text-zinc-500 mb-2">
              INITIAL CAPITAL
            </p>
            <p className="font-pixel text-[10px] text-zinc-300">
              ₹4,00,000
            </p>
          </div>

          <div className="text-center">
            <p className="font-pixel text-[6px] text-zinc-500 mb-2">
              CURRENT CAPITAL
            </p>
            <p className="font-pixel text-[10px] text-white">
              ₹
              {totalCapital > 0
                ? totalCapital.toLocaleString("en-IN")
                : "4,00,000"}
            </p>
          </div>

          <div className="text-center">
            <p className="font-pixel text-[6px] text-zinc-500 mb-2">
              TOTAL P&amp;L
            </p>
            <p
              className="font-pixel text-[10px]"
              style={{
                color: totalPnL >= 0 ? "#22c55e" : "#ef4444",
              }}
            >
              {totalPnL >= 0 ? "+" : ""}₹
              {Math.abs(totalPnL).toLocaleString("en-IN")}
            </p>
          </div>

          <div className="text-center">
            <p className="font-pixel text-[6px] text-zinc-500 mb-2">
              TOTAL P&amp;L %
            </p>
            <p
              className="font-pixel text-[10px]"
              style={{
                color:
                  Number(totalPnLPct) >= 0
                    ? "#22c55e"
                    : "#ef4444",
              }}
            >
              {Number(totalPnLPct) >= 0 ? "+" : ""}
              {totalPnLPct}%
            </p>
          </div>

        </div>

        <div className="flex justify-center">
          <span
            className={`inline-flex items-center gap-2 px-4 py-2 font-pixel text-[8px] border ${
              marketStatus.isOpen
                ? "border-green-500/30 text-green-400"
                : "border-red-500/30 text-red-400"
            }`}
            style={{
              background: marketStatus.isOpen
                ? "rgba(34,197,94,0.06)"
                : "rgba(239,68,68,0.06)",
            }}
          >
            <span
              className={`w-2 h-2 inline-block ${
                marketStatus.isOpen
                  ? "bg-green-400 animate-pulse"
                  : "bg-red-500"
              }`}
            />
            {marketStatus.isOpen
              ? "MARKET OPEN"
              : `MARKET CLOSED${
                  marketStatus.timeUntilOpen
                    ? ` · OPENS IN ${marketStatus.timeUntilOpen.toUpperCase()}`
                    : ""
                }`}
          </span>
        </div>

      </div>

      {/* ── Section 2: Solar System ───────────────────────── */}

      <div className="mb-12">

        <p className="font-pixel text-[7px] text-zinc-600 mb-2 tracking-widest text-center">
          ▸ AI BATTLE GROUND ◂
        </p>

        <p className="font-pixel text-[6px] text-zinc-700 mb-6 text-center">
          CLICK A PLANET TO EXPLORE
        </p>

        {/* Solar system canvas */}
        <div
          style={{
            position: "relative",
            minHeight: 560,
            width: "100%",
          }}
        >

          {botCards.length === 0 ? (

            <div className="flex items-center justify-center h-[560px]">
              <div className="w-10 h-10 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" />
            </div>

          ) : (

            botCards.map((card) => {
              const pos = PLANET_POS[card.botId];
              if (!pos) return null;
              return (
                <PlanetNode
                  key={card.botId}
                  data={card}
                  pos={pos}
                  onClick={() => setSelected(card.botId)}
                />
              );
            })

          )}

        </div>

      </div>

      {/* ── Section 3: Leader Glimpse ─────────────────────── */}

      {leader && (

        <div className="mb-12">

          <p className="font-pixel text-[7px] text-zinc-600 mb-6 tracking-widest">
            ▸ CURRENT LEADER
          </p>

          <div
            style={{
              position: "relative",
              border: `2px solid ${leader.color}`,
              background: "rgba(8,8,20,0.75)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              padding: "20px",
            }}
          >
            {/* Corner squares */}
            {[
              { top: -4, left: -4 },
              { top: -4, right: -4 },
              { bottom: -4, left: -4 },
              { bottom: -4, right: -4 },
            ].map((pos, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  width: 8,
                  height: 8,
                  backgroundColor: leader.color,
                  ...pos,
                }}
              />
            ))}

            <div className="flex items-center justify-between flex-wrap gap-4">

              <div className="flex items-center gap-4">
                <span className="text-3xl">🏆</span>
                <div>
                  <p
                    className="font-pixel text-[10px] mb-2"
                    style={{ color: leader.color }}
                  >
                    {leader.botName}
                  </p>
                  <p
                    className="font-pixel text-sm"
                    style={{
                      color:
                        leader.pnl >= 0 ? "#22c55e" : "#ef4444",
                    }}
                  >
                    {leader.pnl >= 0 ? "+" : ""}₹
                    {Math.abs(leader.pnl).toLocaleString("en-IN")}
                  </p>
                </div>
              </div>

              <Link href="/leaderboard">
                <span className="font-pixel text-[8px] text-zinc-500 hover:text-white transition-colors">
                  VIEW FULL LEADERBOARD →
                </span>
              </Link>

            </div>
          </div>

        </div>

      )}

      {/* ── Section 4: Equity Curve ───────────────────────── */}

      <div>

        <p className="font-pixel text-[7px] text-zinc-600 mb-6 tracking-widest">
          ▸ PORTFOLIO EQUITY CURVE
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
            <div className="h-[240px] flex items-center justify-center">
              <p className="font-pixel text-[7px] text-zinc-700 animate-pulse">
                COLLECTING DATA...
              </p>
            </div>
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityData}>
                  <XAxis
                    dataKey="t"
                    stroke="#27272a"
                    tick={{
                      fontSize: 7,
                      fontFamily: "'Inter', sans-serif",
                      fill: "#52525b",
                    }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="#27272a"
                    tick={{
                      fontSize: 7,
                      fontFamily: "'Inter', sans-serif",
                      fill: "#52525b",
                    }}
                    domain={["auto", "auto"]}
                    width={70}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(8,8,20,0.95)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 0,
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 7,
                      color: "#fff",
                    }}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="v"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                    name="Portfolio Value"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

        </div>

      </div>

      {/* ── Planet expanded overlay ───────────────────────── */}

      {selected && selectedData && (
        <PlanetOverlay
          data={selectedData}
          onClose={() => setSelected(null)}
        />
      )}

    </div>
  );
}
