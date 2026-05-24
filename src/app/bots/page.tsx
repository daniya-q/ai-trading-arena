"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";

import { bots } from "@/data/bots";

// ── Config ────────────────────────────────────────────────────

const BOT_CONFIG: Record<
  string,
  { name: string; color: string }
> = {
  gpt: { name: "GPT", color: "#00A67E" },
  claude: { name: "Claude", color: "#CC785C" },
  gemini: { name: "Gemini", color: "#4285F4" },
  groq: { name: "Groq", color: "#F55036" },
};

// ── Types ─────────────────────────────────────────────────────

type PositionRow = {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  current_price: number;
  pnl: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
};

type BotProfile = {
  botId: string;
  botName: string;
  color: string;
  allocatedCapital: number;
  peakCapital: number;
  pnl: number;
  winRate: number;
  sharpeLike: number;
  // Computed
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  maxDrawdown: number;
  profitFactor: number;
  positions: PositionRow[];
};

// ── Helpers ───────────────────────────────────────────────────

function formatINR(n: number): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

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
        style={{
          bottom: -4,
          left: -4,
          backgroundColor: color,
        }}
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

// ── BotSection ────────────────────────────────────────────────

function BotSection({
  profile,
  expanded,
  onToggle,
}: {
  profile: BotProfile;
  expanded: boolean;
  onToggle: () => void;
}) {
  const {
    color,
    botName,
    pnl,
    winRate,
    sharpeLike,
    maxDrawdown,
    profitFactor,
    totalTrades,
    winningTrades,
    losingTrades,
    allocatedCapital,
    positions,
  } = profile;

  const pctReturn = (
    (pnl / 100000) *
    100
  ).toFixed(2);

  const openPos = positions.filter(
    (p) => p.status === "OPEN"
  );

  const closedPos = positions.filter(
    (p) => p.status === "CLOSED"
  );

  return (
    <PixelBorder color={color} className="bg-zinc-950">

      {/* Header — always visible */}
      <button
        onClick={onToggle}
        className="w-full p-5 text-left"
      >

        <div className="flex items-center justify-between flex-wrap gap-4">

          <div className="flex items-center gap-4">

            <h2
              className="font-pixel text-[11px]"
              style={{ color }}
            >
              {botName}
            </h2>

            <span className="font-pixel text-[6px] text-zinc-600">
              {totalTrades} TRADES
            </span>

          </div>

          <div className="flex items-center gap-8">

            <div className="text-right">
              <p className="font-pixel text-[6px] text-zinc-500 mb-1">
                PNL
              </p>
              <p
                className="font-pixel text-[10px]"
                style={{
                  color: pnl >= 0 ? "#22c55e" : "#ef4444",
                }}
              >
                {pnl >= 0 ? "+" : ""}₹{formatINR(pnl)}
              </p>
            </div>

            <div className="text-right">
              <p className="font-pixel text-[6px] text-zinc-500 mb-1">
                RETURN
              </p>
              <p
                className="font-pixel text-[10px]"
                style={{
                  color:
                    Number(pctReturn) >= 0
                      ? "#22c55e"
                      : "#ef4444",
                }}
              >
                {Number(pctReturn) >= 0 ? "+" : ""}
                {pctReturn}%
              </p>
            </div>

            <span
              className="font-pixel text-[8px]"
              style={{ color }}
            >
              {expanded ? "▲" : "▼"}
            </span>

          </div>

        </div>

      </button>

      {/* Expanded body */}
      {expanded && (

        <div className="px-5 pb-5">

          {/* Stats grid */}
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 pt-4"
            style={{ borderTop: `1px solid ${color}30` }}
          >

            <div>
              <p className="font-pixel text-[6px] text-zinc-500 mb-2">
                WIN RATE
              </p>
              <p className="font-pixel text-[10px] text-white">
                {(winRate * 100).toFixed(1)}%
              </p>
              <p className="font-pixel text-[5px] text-zinc-600 mt-1">
                {winningTrades}W / {losingTrades}L
              </p>
            </div>

            <div>
              <p className="font-pixel text-[6px] text-zinc-500 mb-2">
                SHARPE RATIO
              </p>
              <p className="font-pixel text-[10px] text-white">
                {sharpeLike.toFixed(2)}
              </p>
            </div>

            <div>
              <p className="font-pixel text-[6px] text-zinc-500 mb-2">
                MAX DRAWDOWN
              </p>
              <p
                className="font-pixel text-[10px]"
                style={{
                  color:
                    maxDrawdown > 10
                      ? "#ef4444"
                      : "#f59e0b",
                }}
              >
                {maxDrawdown.toFixed(1)}%
              </p>
            </div>

            <div>
              <p className="font-pixel text-[6px] text-zinc-500 mb-2">
                PROFIT FACTOR
              </p>
              <p
                className="font-pixel text-[10px]"
                style={{
                  color:
                    profitFactor >= 1.5
                      ? "#22c55e"
                      : profitFactor >= 1
                      ? "#f59e0b"
                      : "#ef4444",
                }}
              >
                {profitFactor === Infinity
                  ? "∞"
                  : profitFactor.toFixed(2)}
              </p>
            </div>

            <div>
              <p className="font-pixel text-[6px] text-zinc-500 mb-2">
                CAPITAL
              </p>
              <p className="font-pixel text-[10px] text-white">
                ₹{formatINR(allocatedCapital)}
              </p>
            </div>

            <div>
              <p className="font-pixel text-[6px] text-zinc-500 mb-2">
                OPEN POSITIONS
              </p>
              <p
                className="font-pixel text-[10px]"
                style={{ color }}
              >
                {openPos.length}
              </p>
            </div>

            <div>
              <p className="font-pixel text-[6px] text-zinc-500 mb-2">
                CLOSED TRADES
              </p>
              <p className="font-pixel text-[10px] text-zinc-300">
                {closedPos.length}
              </p>
            </div>

            <div>
              <p className="font-pixel text-[6px] text-zinc-500 mb-2">
                TOTAL TRADES
              </p>
              <p className="font-pixel text-[10px] text-zinc-300">
                {totalTrades}
              </p>
            </div>

          </div>

          {/* Trades table */}
          {positions.length === 0 ? (

            <div
              className="p-6 text-center"
              style={{ border: `1px solid ${color}20` }}
            >
              <p className="font-pixel text-[7px] text-zinc-600">
                NO TRADES YET
              </p>
            </div>

          ) : (

            <div
              style={{ border: `1px solid ${color}20` }}
            >

              {/* Table header */}
              <div className="grid grid-cols-6 px-4 py-3 font-pixel text-[5px] text-zinc-600 uppercase tracking-wider bg-zinc-900/50">
                <span>SYMBOL</span>
                <span>SIDE</span>
                <span className="text-right">ENTRY</span>
                <span className="text-right">EXIT/CUR</span>
                <span className="text-right">PNL</span>
                <span className="text-right">TIME</span>
              </div>

              <div className="max-h-80 overflow-y-auto">

                {positions.map((pos, i) => (

                  <div
                    key={pos.id}
                    className="grid grid-cols-6 px-4 py-3 items-center"
                    style={{
                      borderTop:
                        i > 0
                          ? `1px solid ${color}10`
                          : undefined,
                      background:
                        pos.status === "OPEN"
                          ? `${color}05`
                          : undefined,
                    }}
                  >

                    <span className="font-pixel text-[7px] text-white">
                      {pos.symbol}
                    </span>

                    <span>
                      <span
                        className="font-pixel text-[5px] px-2 py-0.5"
                        style={{
                          color:
                            pos.side === "BUY"
                              ? "#22c55e"
                              : "#ef4444",
                          border: `1px solid ${
                            pos.side === "BUY"
                              ? "#22c55e40"
                              : "#ef444440"
                          }`,
                        }}
                      >
                        {pos.side}
                      </span>
                    </span>

                    <span className="font-pixel text-[6px] text-zinc-400 text-right">
                      ₹{formatINR(pos.entry_price)}
                    </span>

                    <span className="font-pixel text-[6px] text-zinc-400 text-right">
                      ₹{formatINR(pos.current_price)}
                    </span>

                    <span
                      className="font-pixel text-[7px] text-right"
                      style={{
                        color:
                          pos.pnl >= 0
                            ? "#22c55e"
                            : "#ef4444",
                      }}
                    >
                      {pos.pnl >= 0 ? "+" : ""}₹
                      {formatINR(pos.pnl)}
                    </span>

                    <span className="font-pixel text-[5px] text-zinc-600 text-right">
                      {pos.status === "CLOSED" &&
                      pos.closed_at
                        ? formatTime(pos.closed_at)
                        : pos.status === "OPEN"
                        ? "OPEN"
                        : formatTime(pos.opened_at)}
                    </span>

                  </div>

                ))}

              </div>

            </div>

          )}

        </div>

      )}

    </PixelBorder>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function BotsPage() {

  const [profiles, setProfiles] =
    useState<BotProfile[]>([]);

  const [expanded, setExpanded] =
    useState<Record<string, boolean>>({});

  const [loading, setLoading] =
    useState(true);

  const [lastUpdated, setLastUpdated] =
    useState<Date | null>(null);

  async function fetchData() {

    const [capitalRes, positionsRes] =
      await Promise.all([
        supabase.from("capital").select("*"),
        supabase
          .from("positions")
          .select("*")
          .order("opened_at", { ascending: false }),
      ]);

    const capital = capitalRes.data || [];
    const allPositions = positionsRes.data || [];

    const built: BotProfile[] = bots.map((bot) => {
      const cap = capital.find(
        (c) => c.bot_id === bot.id
      );
      const positions = allPositions.filter(
        (p) => p.bot_id === bot.id
      ) as PositionRow[];

      const closedPositions = positions.filter(
        (p) => p.status === "CLOSED"
      );

      const wins = closedPositions.filter(
        (p) => p.pnl > 0
      );

      const losses = closedPositions.filter(
        (p) => p.pnl < 0
      );

      const grossProfit = wins.reduce(
        (s, p) => s + p.pnl,
        0
      );

      const grossLoss = Math.abs(
        losses.reduce((s, p) => s + p.pnl, 0)
      );

      const profitFactor =
        grossLoss > 0
          ? grossProfit / grossLoss
          : grossProfit > 0
          ? Infinity
          : 0;

      const peakCap =
        Number(cap?.peak_capital) || 100000;

      const allocCap =
        Number(cap?.allocated_capital) || 100000;

      const maxDrawdown =
        peakCap > 0
          ? Math.max(
              0,
              ((peakCap - allocCap) / peakCap) * 100
            )
          : 0;

      const cfg = BOT_CONFIG[bot.id] ?? {
        name: bot.id,
        color: "#ffffff",
      };

      return {
        botId: bot.id,
        botName: cfg.name,
        color: cfg.color,
        allocatedCapital: allocCap,
        peakCapital: peakCap,
        pnl: Number(cap?.pnl) || 0,
        winRate: Number(cap?.win_rate) || 0,
        sharpeLike: Number(cap?.sharpe_like) || 0,
        totalTrades: positions.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        maxDrawdown,
        profitFactor,
        positions,
      };
    });

    // Sort by pnl descending
    built.sort((a, b) => b.pnl - a.pnl);

    setProfiles(built);
    setLastUpdated(new Date());
    setLoading(false);

  }

  useEffect(() => {

    fetchData();

    const interval = setInterval(fetchData, 30000);

    return () => clearInterval(interval);

  }, []);

  function toggleBot(botId: string) {
    setExpanded((prev) => ({
      ...prev,
      [botId]: !prev[botId],
    }));
  }

  return (
    <div className="flex-1 p-6 bg-black min-h-screen text-white fade-in">

      {/* Header */}
      <div className="flex items-end justify-between mb-8">

        <div>
          <p className="font-pixel text-[6px] text-zinc-600 mb-3 tracking-widest">
            SEASON 1
          </p>
          <h1 className="font-pixel text-base text-white mb-2">
            BOTS
          </h1>
          <p className="font-pixel text-[7px] text-zinc-500">
            FULL PERFORMANCE BREAKDOWN
          </p>
        </div>

        {lastUpdated && (
          <p className="font-pixel text-[6px] text-zinc-700">
            UPDATED {lastUpdated.toLocaleTimeString()}
          </p>
        )}

      </div>

      {/* Bot sections */}
      {loading ? (

        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" />
        </div>

      ) : (

        <div className="space-y-10">

          {profiles.map((profile, i) => (

            <div key={profile.botId}>

              {/* Rank label */}
              <p
                className="font-pixel text-[6px] mb-4 tracking-widest"
                style={{ color: profile.color }}
              >
                ▸ #{i + 1} RANKED BOT
              </p>

              <BotSection
                profile={profile}
                expanded={expanded[profile.botId] ?? false}
                onToggle={() => toggleBot(profile.botId)}
              />

            </div>

          ))}

        </div>

      )}

    </div>
  );
}
