import { bots } from "@/data/bots";

import { trades } from "@/data/trades";

import { useCandleStore } from "@/store/candleStore";

import { useLeaderboardStore } from "@/store/leaderboardStore";

import { useAIMemoryStore } from "@/store/aiMemoryStore";

import { usePositionStore } from "@/store/positionStore";

import type { Position } from "@/store/positionStore";

import { useCapitalStore } from "@/store/capitalStore";

import { useAIThoughtStore } from "@/store/aiThoughtStore";

import { useMultiAssetStore } from "@/store/multiAssetStore";

import { useExecutionStore } from "@/store/executionStore";

import { useBrokerStore } from "@/store/brokerStore";

import { calculateRSI } from "@/lib/indicators/liveRSI";

import { calculateEMA } from "@/lib/indicators/liveEMA";

import { calculateMACD } from "@/lib/indicators/liveMACD";

import { calculateATR } from "@/lib/indicators/liveATR";

import { calculateBollingerBands } from "@/lib/indicators/liveBollinger";

import { calculateSupertrend } from "@/lib/indicators/liveSupertrend";

import { calculateAdvancedStats } from "@/lib/analytics/calculateAdvancedStats";

import { runAIProvider } from "@/lib/ai/providerRouter";

import { parseAIResponse } from "@/lib/ai/parseAIResponse";

import { simulateExecution } from "@/lib/execution/executionEngine";

import { analyzeMarketStructure } from "@/lib/chart-analysis/analyzeMarketStructure";

import { UpstoxBroker } from "@/lib/broker/upstoxBroker";

import { syncLeaderboard } from "@/lib/supabase/syncLeaderboard";

import { supabase } from "@/lib/supabase/client";

// ── Available Instruments type ────────────────────────────────

export type StrikePreview = {
  strike: number;
  cePremium: number;
  pePremium: number;
};

export type ExpirySlice = {
  expiry: string; // YYYY-MM-DD
  dte: number;
  atm: number;
  strikes: StrikePreview[]; // ATM ±5
};

export type StockQuote = {
  symbol: string;
  price: number;
  change: number;
};

export type AvailableInstruments = {
  niftyOptions: ExpirySlice[];
  sensexOptions: ExpirySlice[];
  bankniftyOptions: ExpirySlice[];
  topStocks: StockQuote[];
};

// ── Helpers ───────────────────────────────────────────────────

let tradingStarted = false;

function fmt(n: number): string {
  return n.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

function fmtPnl(n: number): string {
  return (n >= 0 ? "+" : "") + "₹" + fmt(n);
}

function getHigherTimeframeTrend(
  candles: { close: number }[]
) {
  if (candles.length < 50) {
    return "NEUTRAL";
  }

  const recent = candles
    .slice(-50)
    .map((candle) => candle.close);

  const avg =
    recent.reduce((sum, value) => sum + value, 0) /
    recent.length;

  const latest = recent[recent.length - 1];

  if (latest > avg) return "BULLISH";
  if (latest < avg) return "BEARISH";
  return "NEUTRAL";
}

function detectMarketRegime({
  rsi,
  atr,
  macd,
  signal,
  trend,
}: {
  rsi: number;
  atr: number;
  macd: number;
  signal: number;
  trend: string;
}) {
  if (atr > 180 && Math.abs(macd - signal) > 20) {
    return "BREAKOUT";
  }

  if (trend === "BULLISH" && rsi > 55) {
    return "TRENDING_BULLISH";
  }

  if (trend === "BEARISH" && rsi < 45) {
    return "TRENDING_BEARISH";
  }

  if (rsi > 75 || rsi < 25) {
    return "REVERSAL";
  }

  return "RANGING";
}

function lookupOptionPremium(
  instruments: AvailableInstruments | null,
  instrument: string,
  optionType: "CE" | "PE",
  strike: number,
  expiry: string
): number | null {
  if (!instruments) return null;

  const slices: ExpirySlice[] =
    instrument === "NIFTY"
      ? instruments.niftyOptions
      : instrument === "SENSEX"
      ? instruments.sensexOptions
      : instruments.bankniftyOptions;

  const expirySlice = slices.find((s) => s.expiry === expiry);
  if (!expirySlice) return null;

  const strikeRow = expirySlice.strikes.find(
    (s) => s.strike === strike
  );
  if (!strikeRow) return null;

  return optionType === "CE"
    ? strikeRow.cePremium
    : strikeRow.pePremium;
}

// ── Prompt builder ────────────────────────────────────────────

function buildStrikesTable(strikes: StrikePreview[], atm: number): string {
  return strikes
    .map((s) => {
      const tag = s.strike === atm ? " ◀ATM" : "";
      return `      ${String(s.strike).padStart(6)}   CE ₹${fmt(s.cePremium).padStart(8)}   PE ₹${fmt(s.pePremium).padStart(8)}${tag}`;
    })
    .join("\n");
}

function buildExpirySection(
  label: string,
  slices: ExpirySlice[]
): string {
  if (!slices || slices.length === 0) {
    return `  ${label}: no data`;
  }

  return slices
    .map(
      (slice) =>
        `  ▸ ${label} — Expiry: ${slice.expiry} (DTE: ${slice.dte})  ATM: ${fmt(slice.atm)}\n` +
        `    Strike     CE Premium    PE Premium\n` +
        buildStrikesTable(slice.strikes, slice.atm)
    )
    .join("\n\n");
}

function buildOpenPositionsSection(positions: Position[]): string {
  const open = positions.filter((p) => p.status === "OPEN");

  if (open.length === 0) {
    return "  No open positions — fully in cash.";
  }

  const lines = open.map((p, i) => {
    const base =
      `  ${i + 1}. ${p.symbol} | ${p.side} ×${p.quantity}\n` +
      `     Entry: ₹${fmt(p.entryPrice)}  |  Now: ₹${fmt(p.currentPrice)}  |  PnL: ${fmtPnl(p.pnl)}`;

    if (p.optionType) {
      const expiringSoon = p.isExpiringSoon ? "  ⚠ EXPIRING SOON" : "";
      return (
        base +
        `\n     DTE: ${p.dte ?? "?"}  |  θ: ₹${p.theta ?? 0}/day  |  ${p.itmStatus ?? "?"}  |  Expires: ${p.expiryDate ?? "?"}${expiringSoon}`
      );
    }

    return base;
  });

  const totalDeployed = open.reduce(
    (sum, p) => sum + p.entryPrice * p.quantity,
    0
  );

  lines.push(`\n  Deployed: ₹${fmt(totalDeployed)}`);

  return lines.join("\n");
}

function buildTradingPrompt(params: {
  botName: string;
  botProvider: string;
  marketRegime: string;
  higherTimeframeTrend: string;
  volatility: string;
  rsi: number;
  ema: number;
  macd: number;
  signal: number;
  atr: number;
  bb: { upper: number; middle: number; lower: number };
  supertrend: { trend: string };
  structure: {
    trend: string;
    momentum: string;
    breakout: boolean;
    support: number;
    resistance: number;
    candleSignal: string;
  };
  assets: { symbol: string; price: number; change: number; trend: string; volatility: string }[];
  allocatedCapital: number;
  todayPnL: number;
  rank: number;
  openPositions: Position[];
  lessons: string[];
  confidenceScore: number;
  availableInstruments: AvailableInstruments | null;
}): string {
  const {
    botName,
    botProvider,
    marketRegime,
    higherTimeframeTrend,
    volatility,
    rsi,
    ema,
    macd,
    signal,
    atr,
    bb,
    supertrend,
    structure,
    assets,
    allocatedCapital,
    todayPnL,
    rank,
    openPositions,
    lessons,
    confidenceScore,
    availableInstruments,
  } = params;

  const nifty = assets.find((a) => a.symbol === "NIFTY");
  const banknifty = assets.find((a) => a.symbol === "BANKNIFTY");
  const sensex = assets.find((a) => a.symbol === "SENSEX");

  const todayDate = new Date().toISOString().split("T")[0];

  // ── Instruments section ────────────────────────────────────

  const niftyOptionsSection = availableInstruments
    ? buildExpirySection("NIFTY WEEKLY", availableInstruments.niftyOptions)
    : "  (option chain data not loaded)";

  const sensexOptionsSection = availableInstruments
    ? buildExpirySection("SENSEX WEEKLY", availableInstruments.sensexOptions)
    : "  (option chain data not loaded)";

  const bankniftyOptionsSection = availableInstruments
    ? buildExpirySection("BANKNIFTY MONTHLY", availableInstruments.bankniftyOptions)
    : "  (option chain data not loaded)";

  const stocksSection =
    availableInstruments?.topStocks?.length
      ? availableInstruments.topStocks
          .map(
            (s) =>
              `  ${s.symbol.padEnd(14)} ₹${fmt(s.price).padStart(10)}   ${fmtPnl(s.change).padStart(10)} today`
          )
          .join("\n")
      : "  (stock data not loaded — trade index options or spot)";

  // ── Open positions section ─────────────────────────────────

  const positionsSection = buildOpenPositionsSection(openPositions);

  const openCount = openPositions.filter(
    (p) => p.status === "OPEN"
  ).length;

  const freeCash =
    allocatedCapital -
    openPositions
      .filter((p) => p.status === "OPEN")
      .reduce((sum, p) => sum + p.entryPrice * p.quantity, 0);

  // ── Memory section ─────────────────────────────────────────

  const memorySection =
    lessons.length > 0
      ? lessons
          .slice(0, 10)
          .map((l, i) => `  ${i + 1}. ${l.trim()}`)
          .join("\n")
      : "  No lessons recorded yet — this is a fresh start.";

  // ── Build prompt ───────────────────────────────────────────

  return `You are ${botName} (${botProvider}), an autonomous AI trader in a live competition.

═══════════════════════════════════════════════════════════
  COMPETITION CONTEXT
═══════════════════════════════════════════════════════════
Four AIs compete for maximum ₹ profit from a ₹1,00,000 starting capital:
  • GPT Bot    (OpenAI)
  • Claude Bot (Anthropic)
  • Gemini Bot (Google)
  • Groq Bot   (Meta/Groq)

You are currently ranked #${rank} of 4.
Today: ${todayDate}
No strategy restrictions — you decide instrument, direction, size, and timing.
You manage your own risk.

═══════════════════════════════════════════════════════════
  MARKET SNAPSHOT
═══════════════════════════════════════════════════════════
NIFTY:     ₹${fmt(nifty?.price ?? 0)}   (${fmtPnl(nifty?.change ?? 0)} today)
BANKNIFTY: ₹${fmt(banknifty?.price ?? 0)}   (${fmtPnl(banknifty?.change ?? 0)} today)
SENSEX:    ₹${fmt(sensex?.price ?? 0)}   (${fmtPnl(sensex?.change ?? 0)} today)

Regime:          ${marketRegime}
HTF Trend:       ${higherTimeframeTrend}
Volatility:      ${volatility}
Supertrend:      ${supertrend.trend}
Market Trend:    ${structure.trend}  |  Momentum: ${structure.momentum}
Breakout:        ${structure.breakout}
Support:         ₹${fmt(structure.support)}
Resistance:      ₹${fmt(structure.resistance)}
Candle Signal:   ${structure.candleSignal}

RSI:     ${rsi.toFixed(2)}   (>70 overbought, <30 oversold)
EMA:     ₹${fmt(ema)}
MACD:    ${macd.toFixed(2)}  /  Signal: ${signal.toFixed(2)}  (histogram: ${(macd - signal).toFixed(2)})
ATR:     ${atr.toFixed(2)}   (daily range proxy)
Bollinger: Upper ₹${fmt(bb.upper)}  |  Mid ₹${fmt(bb.middle)}  |  Lower ₹${fmt(bb.lower)}

═══════════════════════════════════════════════════════════
  AVAILABLE INSTRUMENTS
═══════════════════════════════════════════════════════════

── NIFTY OPTIONS (weekly, expires Tuesday) ─────────────
${niftyOptionsSection}

── SENSEX OPTIONS (weekly, expires Thursday) ───────────
${sensexOptionsSection}

── BANKNIFTY OPTIONS (monthly, last Tuesday) ───────────
${bankniftyOptionsSection}

── TOP NIFTY 50 STOCKS ─────────────────────────────────
${stocksSection}

═══════════════════════════════════════════════════════════
  YOUR STATE
═══════════════════════════════════════════════════════════
Bot:              ${botName} (${botProvider})
Allocated:        ₹${fmt(allocatedCapital)}
Free cash:        ₹${fmt(freeCash)}
Today's PnL:      ${fmtPnl(todayPnL)}
Open positions:   ${openCount}
Confidence score: ${confidenceScore}/100

═══════════════════════════════════════════════════════════
  OPEN POSITIONS
═══════════════════════════════════════════════════════════
${positionsSection}

═══════════════════════════════════════════════════════════
  YOUR MEMORY — LAST 10 LESSONS
═══════════════════════════════════════════════════════════
${memorySection}

═══════════════════════════════════════════════════════════
  DECISION REQUIRED
═══════════════════════════════════════════════════════════
Analyse all of the above carefully. Learn from your past mistakes.

Respond ONLY in valid JSON — no markdown, no extra text:

{
  "action": "BUY" | "SELL" | "HOLD" | "CLOSE",
  "symbol": "instrument name or full option label e.g. NIFTY / SENSEX / BANKNIFTY / RELIANCE",
  "optionType": "CE" | "PE" | null,
  "strike": <number or null>,
  "expiry": "YYYY-MM-DD" | null,
  "quantity": <positive integer>,
  "confidence": <0–100>,
  "reasoning": "your private analysis — not shown publicly, be detailed",
  "strategyStatement": "one sentence describing your current strategy — stored and visible to admin"
}

Rules:
• CLOSE: set symbol to the exact symbol of the position you want to close
• BUY/SELL options: optionType must be CE or PE, strike and expiry are required
• BUY/SELL spot/futures: set optionType null, strike null, expiry null
• quantity: number of units / lots (min 1)
• You have ₹${fmt(freeCash)} free — size accordingly
• Adapt your strategy based on your memory of past mistakes
`;
}

// ── Strategy log write ────────────────────────────────────────

async function writeStrategyLog(
  botId: string,
  strategyStatement: string
): Promise<void> {
  const { error } = await supabase.from("strategy_log").insert({
    bot_id: botId,
    strategy: strategyStatement,
    trade_outcome: "PENDING",
    pnl: 0,
  });

  if (error) {
    console.error(
      `[StrategyLog] Insert failed for ${botId}:`,
      error.message
    );
  }
}

// ── Main export ───────────────────────────────────────────────

export function startLiveAITrading(
  availableInstruments: AvailableInstruments | null = null
) {
  if (tradingStarted) {
    return;
  }

  tradingStarted = true;

  /*
    Initialize bot capital
  */

  useCapitalStore
    .getState()
    .initializeBots(bots.map((bot) => bot.name));

  async function executeTradingCycle() {
    try {
      const { niftyCandles } = useCandleStore.getState();

      if (niftyCandles.length < 60) {
        console.log("Waiting for enough candles...");
        return;
      }

      /*
        Indicators
      */

      const rsi = calculateRSI(niftyCandles);
      const ema = calculateEMA(niftyCandles);
      const macdData = calculateMACD(niftyCandles);
      const atr = calculateATR(niftyCandles);
      const bb = calculateBollingerBands(niftyCandles);
      const supertrend = calculateSupertrend(niftyCandles);

      /*
        Market structure
      */

      const structure = analyzeMarketStructure(niftyCandles);

      /*
        Market regime
      */

      const marketRegime = detectMarketRegime({
        rsi,
        atr,
        macd: macdData.macd,
        signal: macdData.signal,
        trend: supertrend.trend,
      });

      const higherTimeframeTrend = getHigherTimeframeTrend(niftyCandles);

      const volatility =
        atr > 200 ? "HIGH" : atr > 100 ? "MEDIUM" : "LOW";

      /*
        Assets
      */

      const assets = useMultiAssetStore.getState().assets;

      /*
        Run all AI bots
      */

      for (const bot of bots) {
        try {
          /*
            AI memory
          */

          const memory =
            useAIMemoryStore.getState().memories[bot.name];

          const lessons = memory?.lessons || [];
          const confidenceScore = memory?.confidenceScore || 50;

          /*
            Capital allocation
          */

          const capitalData = useCapitalStore
            .getState()
            .capitals.find(
              (capital) => capital.bot === bot.name
            );

          const allocatedCapital =
            capitalData?.allocatedCapital || 100000;

          const todayPnL = capitalData?.pnl || 0;

          /*
            Leaderboard rank
          */

          const leaderboard =
            useLeaderboardStore.getState().leaderboard;

          const rank =
            leaderboard.findIndex((entry) => entry.bot === bot.name) +
            1 || 4;

          /*
            Open positions for this bot
          */

          const botPositions = usePositionStore
            .getState()
            .positions.filter((p) => p.bot === bot.name);

          /*
            Build prompt
          */

          const prompt = buildTradingPrompt({
            botName: bot.name,
            botProvider: bot.provider,
            marketRegime,
            higherTimeframeTrend,
            volatility,
            rsi,
            ema,
            macd: macdData.macd,
            signal: macdData.signal,
            atr,
            bb,
            supertrend,
            structure,
            assets,
            allocatedCapital,
            todayPnL,
            rank,
            openPositions: botPositions,
            lessons,
            confidenceScore,
            availableInstruments,
          });

          /*
            Run AI
          */

          const rawResponse = await runAIProvider(
            bot.provider,
            prompt
          );

          const parsed = parseAIResponse(rawResponse);

          /*
            Save AI thought
          */

          useAIThoughtStore.getState().addThought({
            bot: bot.name,
            thought: parsed.reasoning,
            confidence: parsed.confidence,
            marketRegime,
            action: parsed.action,
            timestamp: new Date().toISOString(),
          });

          console.log(`${bot.name} Parsed:`, parsed);

          /*
            Write strategy log to Supabase (every cycle, regardless of action)
          */

          writeStrategyLog(bot.id, parsed.strategyStatement);

          /*
            HOLD — nothing to do
          */

          if (parsed.action === "HOLD") {
            continue;
          }

          /*
            CLOSE — close an existing position
          */

          if (parsed.action === "CLOSE") {
            const toClose = usePositionStore
              .getState()
              .positions.find(
                (p) =>
                  p.bot === bot.name &&
                  p.status === "OPEN" &&
                  (!parsed.symbol ||
                    p.symbol === parsed.symbol)
              );

            if (toClose) {
              usePositionStore
                .getState()
                .closePosition(toClose.id);

              console.log(
                `${bot.name} CLOSED ${toClose.symbol}`
              );
            } else {
              console.warn(
                `${bot.name} CLOSE: no open position matches "${parsed.symbol}"`
              );
            }

            continue;
          }

          /*
            BUY / SELL — determine entry price
          */

          let entryAssetPrice: number;
          let entrySymbol: string = parsed.symbol || "NIFTY";

          if (parsed.optionType && parsed.strike && parsed.expiry) {
            /*
              Options trade — look up premium from instrument data
            */

            const premium = lookupOptionPremium(
              availableInstruments,
              parsed.symbol,
              parsed.optionType,
              parsed.strike,
              parsed.expiry
            );

            if (!premium) {
              console.warn(
                `${bot.name}: premium not found for ${parsed.symbol} ${parsed.optionType} ${parsed.strike} ${parsed.expiry} — skipping`
              );
              continue;
            }

            entryAssetPrice = premium;
            entrySymbol = `${parsed.symbol} ${parsed.optionType} ${parsed.strike} ${parsed.expiry}`;
          } else {
            /*
              Spot / futures trade — use index price
            */

            const selectedAsset = assets.find(
              (asset) => asset.symbol === parsed.symbol
            );

            if (!selectedAsset) {
              console.warn(
                `${bot.name}: unknown symbol "${parsed.symbol}" — skipping`
              );
              continue;
            }

            entryAssetPrice = selectedAsset.price;
          }

          /*
            Simulated execution (slippage + fees)
          */

          const selectedAssetForExec = assets.find(
            (a) => a.symbol === parsed.symbol
          ) || assets[0];

          const execution = simulateExecution({
            side: parsed.action as "BUY" | "SELL",
            marketPrice: entryAssetPrice,
            quantity: parsed.quantity,
            volatility: selectedAssetForExec?.volatility ?? "LOW",
          });

          const actualEntryPrice = execution.executedPrice;

          /*
            Stop loss / take profit (ATR-based)
          */

          const stopLoss =
            parsed.action === "BUY"
              ? actualEntryPrice - atr * 1.2
              : actualEntryPrice + atr * 1.2;

          const takeProfit =
            parsed.action === "BUY"
              ? actualEntryPrice + atr * 2
              : actualEntryPrice - atr * 2;

          /*
            REAL PAPER ORDER
          */

          const { paperTrading } = useBrokerStore.getState();

          if (paperTrading) {
            try {
              const broker = new UpstoxBroker();

              await broker.placeOrder({
                symbol: parsed.symbol,
                side: parsed.action as "BUY" | "SELL",
                quantity: parsed.quantity,
                orderType: "MARKET",
                product: "D",
                validity: "DAY",
              });

              console.log("REAL PAPER ORDER SENT");
            } catch (brokerError) {
              console.error(
                "Broker Execution Failed:",
                brokerError
              );
            }
          }

          /*
            Open position in store
          */

          const positionPayload: Position = {
            id: Date.now(),
            bot: bot.name,
            symbol: entrySymbol,
            side: parsed.action,
            quantity: parsed.quantity,
            entryPrice: Number(actualEntryPrice.toFixed(2)),
            currentPrice: Number(actualEntryPrice.toFixed(2)),
            stopLoss: Number(stopLoss.toFixed(2)),
            takeProfit: Number(takeProfit.toFixed(2)),
            pnl: 0,
            status: "OPEN",
            openedAt: new Date().toISOString(),
            // Options metadata
            ...(parsed.optionType
              ? {
                  optionType: parsed.optionType,
                  strike: parsed.strike ?? undefined,
                  expiryDate: parsed.expiry ?? undefined,
                }
              : {}),
          };

          const created = usePositionStore
            .getState()
            .addPosition(positionPayload);

          if (!created) {
            continue;
          }

          /*
            Save execution analytics
          */

          useExecutionStore.getState().addExecution({
            bot: bot.name,
            symbol: entrySymbol,
            side: parsed.action,
            requestedPrice: entryAssetPrice,
            executedPrice: execution.executedPrice,
            slippage: execution.slippage,
            fees: execution.fees,
            latency: execution.latency,
            timestamp: new Date().toISOString(),
          });

          console.log(`${bot.name} OPENED ${entrySymbol}`);

          console.log("Execution Details:", {
            executedPrice: execution.executedPrice,
            slippage: execution.slippage,
            fees: execution.fees,
            latency: execution.latency,
          });
        } catch (botError) {
          console.error(`${bot.name} Error:`, botError);
        }
      }

      /*
        Leaderboard analytics
      */

      const leaderboard = bots.map((bot) => {
        const botTrades = trades.filter(
          (trade) => trade.bot === bot.name
        );

        const stats = calculateAdvancedStats(botTrades);

        useCapitalStore.getState().updateBotCapital(bot.name, {
          pnl: stats.totalPnL,
          winRate: stats.winRate,
          sharpeLike: stats.sharpeLike,
        });

        return {
          bot: bot.name,
          ...stats,
        };
      });

      /*
        Capital rebalance
      */

      useCapitalStore.getState().rebalanceCapital();

      leaderboard.sort((a, b) => {
        if (b.sharpeLike !== a.sharpeLike) {
          return b.sharpeLike - a.sharpeLike;
        }

        return b.totalPnL - a.totalPnL;
      });

      useLeaderboardStore.getState().setLeaderboard(leaderboard);

      /*
        Sync leaderboard stats to Supabase capital table
      */

      syncLeaderboard(leaderboard);
    } catch (error) {
      console.error("AI Trading Error:", error);
    }
  }

  executeTradingCycle();

  setInterval(() => {
    executeTradingCycle();
  }, 15000);
}
