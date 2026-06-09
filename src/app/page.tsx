"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────

type Strategy = {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused" | "placeholder";
  slot_number: number;
};

type Capital = {
  strategy_id: string;
  allocated_capital: number;
  current_value: number;
  total_pnl: number;
  win_rate: number;
  sharpe_ratio: number;
  today_trades: number;
  lifetime_trades: number;
};

type Position = {
  id: string;
  strategy_id: string;
  symbol: string;
  type: string;
  entry_price: number;
  current_price: number;
  exit_price: number | null;
  quantity: number;
  pnl: number;
  status: "OPEN" | "CLOSED";
  opened_at: string;
  closed_at: string | null;
  exit_reason: string | null;
};

// ── Formatters ─────────────────────────────────────────────────

function fmtINR(n: number): string {
  return Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function pnlStr(n: number): string {
  return `${n >= 0 ? "+" : "-"}₹${fmtINR(n)}`;
}

function pnlColor(n: number): string {
  if (n === 0) return "#6b7280";
  return n > 0 ? "#22c55e" : "#ef4444";
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ── LockedCard ─────────────────────────────────────────────────

function LockedCard({ strategy }: { strategy: Strategy }) {
  return (
    <div
      style={{
        background: "#080B12",
        border: "1px solid #0f1520",
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 90,
        gap: 6,
      }}
    >
      <div style={{ fontSize: 16, color: "#1a2030" }}>⬡</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#1a2030", letterSpacing: "0.12em" }}>
        SLOT {strategy.slot_number}
      </div>
      <div style={{ fontSize: 10, color: "#1a2030" }}>COMING SOON</div>
    </div>
  );
}

// ── TradeRow ───────────────────────────────────────────────────

function TradeRow({ pos }: { pos: Position }) {
  const isOpen     = pos.status === "OPEN";
  const dispPrice  = isOpen ? pos.current_price : (pos.exit_price ?? pos.current_price);
  const pnlVal     = pos.pnl ?? 0;

  return (
    <tr style={{ borderTop: "1px solid #0f1520", background: isOpen ? "rgba(245,213,71,0.015)" : "transparent" }}>
      <td style={{ padding: "6px 8px", fontSize: 11, color: "#c9d1d9", whiteSpace: "nowrap" }}>
        {pos.symbol}
      </td>
      <td style={{ padding: "6px 6px", fontSize: 11, fontWeight: 700, color: pos.type === "CE" ? "#22c55e" : "#ef4444" }}>
        {pos.type}
      </td>
      <td style={{ padding: "6px 6px", fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>
        ₹{(pos.entry_price ?? 0).toFixed(2)}
      </td>
      <td style={{ padding: "6px 6px", fontSize: 11, fontFamily: "monospace", color: isOpen ? "#f5d547" : "#4b5563" }}>
        ₹{(dispPrice ?? 0).toFixed(2)}
      </td>
      <td style={{ padding: "6px 6px", fontSize: 11, color: "#6b7280" }}>
        {pos.quantity}
      </td>
      <td style={{ padding: "6px 6px", fontSize: 11, fontFamily: "monospace", fontWeight: 600, color: isOpen ? "#f5d547" : pnlColor(pnlVal) }}>
        {pnlStr(pnlVal)}
      </td>
      <td style={{ padding: "6px 6px", fontSize: 10, whiteSpace: "nowrap" }}>
        {isOpen ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#f5d547" }}>
            <span
              className="pulse"
              style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#f5d547" }}
            />
            Open
          </span>
        ) : (
          <span style={{ color: "#374151" }}>Closed</span>
        )}
      </td>
      <td style={{ padding: "6px 6px", fontSize: 10, color: "#374151" }}>
        {fmtTime(pos.opened_at)}
      </td>
    </tr>
  );
}

// ── StrategyCard ───────────────────────────────────────────────

function StrategyCard({
  strategy,
  capital,
  positions,
}: {
  strategy: Strategy;
  capital: Capital | undefined;
  positions: Position[];
}) {
  const pnl    = capital?.total_pnl ?? 0;
  const retPct = (pnl / 100000) * 100;
  const sharpe = capital?.sharpe_ratio ?? 0;
  const today  = capital?.today_trades ?? 0;
  const life   = capital?.lifetime_trades ?? 0;

  const recentPos = positions.slice(0, 30);

  return (
    <div
      style={{
        background: "#0B0E17",
        border: "1px solid #111827",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid #111827" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ffffff" }}>{strategy.name}</div>
            <div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>{strategy.description}</div>
          </div>
          <div style={{ fontSize: 9, color: "#1f2937", letterSpacing: "0.1em" }}>#{strategy.slot_number}</div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderBottom: "1px solid #111827" }}>
        {[
          { label: "CAPITAL",  value: "₹1,00,000",          color: "#6b7280" },
          { label: "TOTAL PNL",value: pnlStr(pnl),           color: pnlColor(pnl) },
          { label: "RETURN",   value: fmtPct(retPct),        color: pnlColor(retPct) },
          { label: "SHARPE",   value: sharpe.toFixed(2),     color: "#6b7280" },
          { label: "TODAY",    value: String(today),          color: "#6b7280" },
          { label: "LIFETIME", value: String(life),           color: "#6b7280" },
        ].map((s, i) => (
          <div
            key={s.label}
            style={{
              padding: "8px 10px",
              borderRight: i % 3 < 2 ? "1px solid #111827" : undefined,
              borderTop: i >= 3 ? "1px solid #111827" : undefined,
            }}
          >
            <div style={{ fontSize: 8, color: "#1f2937", letterSpacing: "0.1em", marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Trade log */}
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 240, flex: 1 }}>
        {recentPos.length === 0 ? (
          <div style={{ padding: "18px 14px", fontSize: 11, color: "#1f2937", textAlign: "center" }}>
            No trades yet
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
            <thead>
              <tr style={{ background: "#070A11", position: "sticky", top: 0 }}>
                {["Symbol", "Type", "Entry", "Cur/Exit", "Qty", "PnL", "Status", "Time"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "5px 6px 5px 8px",
                      fontSize: 9,
                      fontWeight: 600,
                      color: "#1f2937",
                      letterSpacing: "0.08em",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentPos.map((pos) => (
                <TradeRow key={pos.id} pos={pos} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Dashboard Page ─────────────────────────────────────────────

export default function DashboardPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [capitals,   setCapitals]   = useState<Capital[]>([]);
  const [positions,  setPositions]  = useState<Position[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [sRes, cRes, pRes] = await Promise.all([
      supabase.from("strategies").select("*").order("slot_number"),
      supabase.from("strategy_capital").select("*"),
      supabase
        .from("strategy_positions")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(300),
    ]);

    if (sRes.error || cRes.error || pRes.error) {
      const msg =
        sRes.error?.message ?? cRes.error?.message ?? pRes.error?.message ?? "Unknown";
      setError(msg);
      return;
    }

    setError(null);
    setStrategies((sRes.data ?? []) as Strategy[]);
    setCapitals((cRes.data ?? []) as Capital[]);
    setPositions((pRes.data ?? []) as Position[]);
    setLastUpdate(new Date());
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const active = strategies.filter((s) => s.status !== "placeholder").sort((a, b) => a.slot_number - b.slot_number);
  const locked = strategies.filter((s) => s.status === "placeholder").sort((a, b) => a.slot_number - b.slot_number);

  const activeCols = Math.min(active.length, 6) || 1;

  return (
    <div style={{ background: "#0A0D14", minHeight: "100vh", padding: "18px 16px 32px" }}>
      {/* Page header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 9, color: "#1f2937", letterSpacing: "0.15em", marginBottom: 4 }}>
            AI TRADING ARENA · SEASON 1 · PAPER TRADING
          </div>
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#e5e7eb" }}>
            Strategy Dashboard
          </h1>
        </div>
        <div style={{ fontSize: 9, color: "#374151" }}>
          {lastUpdate
            ? `UPDATED ${lastUpdate.toLocaleTimeString()} · AUTO-REFRESH 15s`
            : "CONNECTING..."}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: "9px 12px",
            background: "rgba(239,68,68,0.05)",
            border: "1px solid rgba(239,68,68,0.15)",
            color: "#ef4444",
            fontSize: 11,
          }}
        >
          Supabase error: {error} —{" "}
          <span style={{ color: "#4b5563" }}>
            Run migration 003_strategy_tables.sql in your Supabase dashboard first.
          </span>
        </div>
      )}

      {/* Active strategy cards */}
      {active.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${activeCols}, 1fr)`,
            gap: 1,
          }}
        >
          {active.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              capital={capitals.find((c) => c.strategy_id === s.id)}
              positions={positions.filter((p) => p.strategy_id === s.id)}
            />
          ))}
        </div>
      )}

      {/* Locked cards */}
      {locked.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(locked.length, 4)}, 1fr)`,
            gap: 1,
            marginTop: 1,
          }}
        >
          {locked.map((s) => (
            <LockedCard key={s.id} strategy={s} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {strategies.length === 0 && !error && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 8 }}>
          <div style={{ fontSize: 12, color: "#374151" }}>Waiting for data...</div>
          <div style={{ fontSize: 10, color: "#1f2937" }}>
            If tables are missing, run supabase/migrations/003_strategy_tables.sql
          </div>
        </div>
      )}
    </div>
  );
}
