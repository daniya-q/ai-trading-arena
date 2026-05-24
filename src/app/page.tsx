"use client";

import { useEffect, useState } from "react";

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

const BOT_CONFIG: Record<string, { name: string; color: string }> =
  {
    gpt: { name: "GPT", color: "#00A67E" },
    claude: { name: "Claude", color: "#CC785C" },
    gemini: { name: "Gemini", color: "#4285F4" },
    groq: { name: "Groq", color: "#F55036" },
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

// ── IST / Market helpers ───────────────────────────────────────

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
  const istOpen = new Date(ist);
  istOpen.setHours(9, 15, 0, 0);
  return new Date(
    istOpen.getTime() - 5.5 * 60 * 60 * 1000
  );
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
  const isOpen =
    weekday && total >= open && total < close;

  if (isOpen) return { isOpen: true, timeUntilOpen: "" };

  let mins = 0;

  if (weekday && total < open) {
    mins = open - total;
  } else {
    const ahead =
      day === 5 && total >= close
        ? 3
        : day === 6
        ? 2
        : day === 0
        ? 1
        : 1;
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

// ── Pixel art bot SVG avatars ──────────────────────────────────

function GptAvatar({ color }: { color: string }) {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      style={{ imageRendering: "pixelated" }}
    >
      <rect x="7" y="0" width="2" height="2" fill={color} />
      <rect x="6" y="2" width="4" height="1" fill={color} />
      <rect x="2" y="3" width="12" height="7" fill={color} />
      <rect x="3" y="5" width="3" height="2" fill="white" />
      <rect x="10" y="5" width="3" height="2" fill="white" />
      <rect x="4" y="6" width="1" height="1" fill={color} />
      <rect x="11" y="6" width="1" height="1" fill={color} />
      <rect x="4" y="9" width="8" height="1" fill="white" />
      <rect x="4" y="11" width="8" height="3" fill={color} />
      <rect x="4" y="14" width="3" height="2" fill={color} />
      <rect x="9" y="14" width="3" height="2" fill={color} />
    </svg>
  );
}

function ClaudeAvatar({ color }: { color: string }) {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      style={{ imageRendering: "pixelated" }}
    >
      <rect x="3" y="1" width="10" height="1" fill={color} />
      <rect x="2" y="2" width="12" height="7" fill={color} />
      <rect x="3" y="3" width="3" height="3" fill="white" />
      <rect x="10" y="3" width="3" height="3" fill="white" />
      <rect x="4" y="4" width="1" height="2" fill={color} />
      <rect x="11" y="4" width="1" height="2" fill={color} />
      <rect x="4" y="7" width="2" height="1" fill="white" />
      <rect x="10" y="7" width="2" height="1" fill="white" />
      <rect x="6" y="8" width="4" height="1" fill="white" />
      <rect x="4" y="10" width="8" height="3" fill={color} />
      <rect x="4" y="13" width="3" height="3" fill={color} />
      <rect x="9" y="13" width="3" height="3" fill={color} />
    </svg>
  );
}

function GeminiAvatar({ color }: { color: string }) {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      style={{ imageRendering: "pixelated" }}
    >
      <rect x="3" y="0" width="2" height="3" fill={color} />
      <rect x="11" y="0" width="2" height="3" fill={color} />
      <rect x="2" y="3" width="12" height="7" fill={color} />
      <rect x="4" y="5" width="3" height="1" fill="white" />
      <rect x="5" y="4" width="1" height="3" fill="white" />
      <rect x="10" y="5" width="3" height="1" fill="white" />
      <rect x="11" y="4" width="1" height="3" fill="white" />
      <rect x="5" y="8" width="6" height="1" fill="white" />
      <rect x="4" y="11" width="8" height="3" fill={color} />
      <rect x="4" y="14" width="3" height="2" fill={color} />
      <rect x="9" y="14" width="3" height="2" fill={color} />
    </svg>
  );
}

function GroqAvatar({ color }: { color: string }) {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      style={{ imageRendering: "pixelated" }}
    >
      <rect x="7" y="0" width="3" height="1" fill={color} />
      <rect x="8" y="1" width="2" height="1" fill={color} />
      <rect x="6" y="2" width="3" height="1" fill={color} />
      <rect x="7" y="3" width="2" height="1" fill={color} />
      <rect x="2" y="4" width="12" height="6" fill={color} />
      <rect x="3" y="5" width="4" height="1" fill="#8B0000" />
      <rect x="9" y="5" width="4" height="1" fill="#8B0000" />
      <rect x="3" y="6" width="4" height="1" fill="white" />
      <rect x="9" y="6" width="4" height="1" fill="white" />
      <rect x="3" y="8" width="10" height="1" fill="white" />
      <rect x="4" y="9" width="2" height="1" fill="white" />
      <rect x="10" y="9" width="2" height="1" fill="white" />
      <rect x="4" y="11" width="8" height="3" fill={color} />
      <rect x="4" y="14" width="3" height="2" fill={color} />
      <rect x="9" y="14" width="3" height="2" fill={color} />
    </svg>
  );
}

const AVATARS: Record<
  string,
  ({ color }: { color: string }) => React.ReactElement
> = {
  gpt: GptAvatar,
  claude: ClaudeAvatar,
  gemini: GeminiAvatar,
  groq: GroqAvatar,
};

// ── PixelBorder ───────────────────────────────────────────────

function PixelBorder({
  color,
  children,
  className = "",
}: {
  color: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative ${className}`}
      style={{ border: `2px solid ${color}` }}
    >
      <div
        className="absolute w-2 h-2"
        style={{ top: -4, left: -4, backgroundColor: color }}
      />
      <div
        className="absolute w-2 h-2"
        style={{ top: -4, right: -4, backgroundColor: color }}
      />
      <div
        className="absolute w-2 h-2"
        style={{ bottom: -4, left: -4, backgroundColor: color }}
      />
      <div
        className="absolute w-2 h-2"
        style={{
          bottom: -4,
          right: -4,
          backgroundColor: color,
        }}
      />
      {children}
    </div>
  );
}

// ── BotCard ───────────────────────────────────────────────────

function BotCard({ data }: { data: BotCardData }) {
  const {
    color,
    botId,
    botName,
    rank,
    pnl,
    winRate,
    totalTrades,
    allocatedCapital,
    openSymbol,
    carrySymbol,
  } = data;

  const AvatarComp = AVATARS[botId] || GptAvatar;

  const pctReturn = (
    (pnl / PER_BOT_CAPITAL) *
    100
  ).toFixed(1);

  const capitalPct = (allocatedCapital / PER_BOT_CAPITAL) * 100;

  const barColor =
    allocatedCapital >= PER_BOT_CAPITAL
      ? "#22c55e"
      : "#ef4444";

  return (
    <PixelBorder color={color} className="bg-zinc-950 p-5">

      {/* Rank badge */}
      <div
        className="absolute top-2 right-3 font-pixel text-[9px]"
        style={{ color }}
      >
        #{rank}
      </div>

      {/* Avatar + Name */}
      <div className="flex items-center gap-4 mb-5">

        <AvatarComp color={color} />

        <div>
          <h3
            className="font-pixel text-[11px]"
            style={{ color }}
          >
            {botName}
          </h3>
          <p className="font-pixel text-[6px] text-zinc-600 mt-2">
            AI TRADER
          </p>
        </div>

      </div>

      {/* Stats 2x3 grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5">

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
            style={{ color: openSymbol ? color : "#52525b" }}
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
      <div>

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

        <div className="w-full h-2 bg-zinc-800">
          <div
            className="h-full transition-all duration-700"
            style={{
              width: `${Math.min(capitalPct, 100)}%`,
              backgroundColor: barColor,
            }}
          />
        </div>

        <div className="flex justify-between mt-1">
          <p className="font-pixel text-[5px] text-zinc-700">
            ₹0
          </p>
          <p className="font-pixel text-[5px] text-zinc-700">
            ₹{(allocatedCapital / 1000).toFixed(1)}K
          </p>
        </div>

      </div>

    </PixelBorder>
  );
}

// ── Data fetcher ───────────────────────────────────────────────

async function fetchBotCardData(): Promise<BotCardData[]> {

  const todayOpen = getTodayMarketOpenUTC();

  const [capitalRes, openPosRes, allPosRes] =
    await Promise.all([
      supabase.from("capital").select("*"),
      supabase
        .from("positions")
        .select("bot_id, symbol, opened_at")
        .eq("status", "OPEN"),
      supabase.from("positions").select("bot_id"),
    ]);

  const tradeCounts: Record<string, number> = {};

  (allPosRes.data || []).forEach((r) => {
    tradeCounts[r.bot_id] =
      (tradeCounts[r.bot_id] || 0) + 1;
  });

  const openPos = openPosRes.data || [];
  const capital = capitalRes.data || [];

  const data: BotCardData[] = bots.map((bot) => {
    const cap = capital.find((c) => c.bot_id === bot.id);
    const botOpen = openPos.filter(
      (p) => p.bot_id === bot.id
    );
    const openSymbol = botOpen[0]?.symbol ?? null;
    const carry = botOpen.find(
      (p) => new Date(p.opened_at) < todayOpen
    );
    const cfg = BOT_CONFIG[bot.id] ?? {
      name: bot.id,
      color: "#ffffff",
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
      totalTrades: tradeCounts[bot.id] || 0,
      openSymbol,
      carrySymbol: carry?.symbol ?? null,
    };
  });

  data.sort((a, b) => b.pnl - a.pnl);

  data.forEach((d, i) => {
    d.rank = i + 1;
  });

  return data;
}

// ── Page ──────────────────────────────────────────────────────

export default function Home() {

  const { capitals } = useCapitalStore();

  const [botCards, setBotCards] =
    useState<BotCardData[]>([]);

  const [equityData, setEquityData] =
    useState<{ t: string; v: number }[]>([]);

  const [marketStatus, setMarketStatus] =
    useState(getMarketStatus);

  const [mounted, setMounted] = useState(false);

  const totalCapital = capitals.reduce(
    (s, b) => s + b.allocatedCapital,
    0
  );

  const totalPnL = capitals.reduce(
    (s, b) => s + b.pnl,
    0
  );

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
    ]).then(() => {
      startLiveAITrading();
    });

    startMarketWebSocket();
    startRestPolling();
    refreshBotCards();

    const eqInterval = setInterval(() => {
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

    const cardInterval = setInterval(refreshBotCards, 30000);

    const statusInterval = setInterval(() => {
      setMarketStatus(getMarketStatus());
    }, 30000);

    return () => {
      clearInterval(eqInterval);
      clearInterval(cardInterval);
      clearInterval(statusInterval);
    };

  }, []);

  if (!mounted) return null;

  const leader = botCards[0];

  return (
    <div className="flex-1 p-6 bg-black min-h-screen text-white fade-in">

      {/* ── Section 1: Competition Header ─────────────────── */}

      <div
        className="mb-10 p-6"
        style={{
          border: "2px dashed #3f3f46",
          background:
            "linear-gradient(135deg,#0a0a0a 0%,#111111 100%)",
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
                ? "border-green-500/40 text-green-400 bg-green-500/5"
                : "border-red-500/40 text-red-400 bg-red-500/5"
            }`}
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

      {/* ── Section 2: Bot Cards ──────────────────────────── */}

      <div className="mb-12">

        <p className="font-pixel text-[7px] text-zinc-600 mb-6 tracking-widest">
          ▸ CONTESTANTS
        </p>

        {botCards.length === 0 ? (

          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" />
          </div>

        ) : (

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {botCards.map((card) => (
              <BotCard key={card.botId} data={card} />
            ))}
          </div>

        )}

      </div>

      {/* ── Section 3: Leaderboard Glimpse ───────────────── */}

      {leader && (

        <div className="mb-12">

          <p className="font-pixel text-[7px] text-zinc-600 mb-6 tracking-widest">
            ▸ CURRENT LEADER
          </p>

          <PixelBorder
            color={leader.color}
            className="bg-zinc-950 p-5"
          >

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
                        leader.pnl >= 0
                          ? "#22c55e"
                          : "#ef4444",
                    }}
                  >
                    {leader.pnl >= 0 ? "+" : ""}₹
                    {Math.abs(leader.pnl).toLocaleString(
                      "en-IN"
                    )}
                  </p>
                </div>

              </div>

              <Link href="/leaderboard">
                <span className="font-pixel text-[8px] text-zinc-500 hover:text-white transition-colors">
                  VIEW FULL LEADERBOARD →
                </span>
              </Link>

            </div>

          </PixelBorder>

        </div>

      )}

      {/* ── Section 4: Equity Curve ───────────────────────── */}

      <div>

        <p className="font-pixel text-[7px] text-zinc-600 mb-6 tracking-widest">
          ▸ PORTFOLIO EQUITY CURVE
        </p>

        <div
          className="p-4 bg-zinc-950"
          style={{ border: "1px solid #27272a" }}
        >

          {equityData.length < 2 ? (

            <div className="h-[240px] flex items-center justify-center">
              <p className="font-pixel text-[7px] text-zinc-700 animate-pulse">
                COLLECTING DATA...
              </p>
            </div>

          ) : (

            <div className="h-[240px]">

              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <LineChart data={equityData}>

                  <XAxis
                    dataKey="t"
                    stroke="#3f3f46"
                    tick={{
                      fontSize: 7,
                      fontFamily:
                        "'Press Start 2P', cursive",
                      fill: "#52525b",
                    }}
                    interval="preserveStartEnd"
                  />

                  <YAxis
                    stroke="#3f3f46"
                    tick={{
                      fontSize: 7,
                      fontFamily:
                        "'Press Start 2P', cursive",
                      fill: "#52525b",
                    }}
                    domain={["auto", "auto"]}
                    width={70}
                  />

                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      border: "1px solid #3f3f46",
                      borderRadius: 0,
                      fontFamily:
                        "'Press Start 2P', cursive",
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

    </div>
  );
}
