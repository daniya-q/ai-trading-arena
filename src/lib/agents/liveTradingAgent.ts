import { bots } from "@/data/bots";

import { trades } from "@/data/trades";

import { useCandleStore } from "@/store/candleStore";

import { useLeaderboardStore } from "@/store/leaderboardStore";

import { useAIMemoryStore } from "@/store/aiMemoryStore";

import { usePositionStore } from "@/store/positionStore";

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

let tradingStarted = false;

function getHigherTimeframeTrend(
  candles: {
    close: number;
  }[]
) {

  if (
    candles.length < 50
  ) {
    return "NEUTRAL";
  }

  const recent =
    candles
      .slice(-50)
      .map(
        (candle) =>
          candle.close
      );

  const avg =
    recent.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / recent.length;

  const latest =
    recent[
      recent.length - 1
    ];

  if (latest > avg) {
    return "BULLISH";
  }

  if (latest < avg) {
    return "BEARISH";
  }

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

  if (
    atr > 180 &&
    Math.abs(
      macd - signal
    ) > 20
  ) {
    return "BREAKOUT";
  }

  if (
    trend ===
      "BULLISH" &&
    rsi > 55
  ) {
    return "TRENDING_BULLISH";
  }

  if (
    trend ===
      "BEARISH" &&
    rsi < 45
  ) {
    return "TRENDING_BEARISH";
  }

  if (
    rsi > 75 ||
    rsi < 25
  ) {
    return "REVERSAL";
  }

  return "RANGING";
}

export function startLiveAITrading() {

  if (tradingStarted) {
    return;
  }

  tradingStarted = true;

  /*
    Initialize bot capital
  */

  useCapitalStore
    .getState()
    .initializeBots(
      bots.map(
        (bot) => bot.name
      )
    );

  async function executeTradingCycle() {

    try {

      const {
        niftyCandles,
      } =
        useCandleStore.getState();

      if (
        niftyCandles.length <
        60
      ) {

        console.log(
          "Waiting for enough candles..."
        );

        return;
      }

      /*
        Indicators
      */

      const rsi =
        calculateRSI(
          niftyCandles
        );

      const ema =
        calculateEMA(
          niftyCandles
        );

      const macdData =
        calculateMACD(
          niftyCandles
        );

      const atr =
        calculateATR(
          niftyCandles
        );

      calculateBollingerBands(
        niftyCandles
      );

      const supertrend =
        calculateSupertrend(
          niftyCandles
        );

      /*
        Market structure
      */

      const structure =
        analyzeMarketStructure(
          niftyCandles
        );

      /*
        Market regime
      */

      const marketRegime =
        detectMarketRegime({
          rsi,

          atr,

          macd:
            macdData.macd,

          signal:
            macdData.signal,

          trend:
            supertrend.trend,
        });

      const higherTimeframeTrend =
        getHigherTimeframeTrend(
          niftyCandles
        );

      const volatility =
        atr > 200
          ? "HIGH"
          : atr > 100
          ? "MEDIUM"
          : "LOW";

      /*
        Assets
      */

      const assets =
        useMultiAssetStore
          .getState()
          .assets;

      /*
        Run all AI bots
      */

      for (const bot of bots) {

        try {

          /*
            Existing position check
          */

          const existingOpen =
            usePositionStore
              .getState()
              .positions.find(
                (
                  position
                ) =>
                  position.bot ===
                    bot.name &&
                  position.status ===
                    "OPEN"
              );

          if (
            existingOpen
          ) {
            continue;
          }

          /*
            AI memory
          */

          const memory =
            useAIMemoryStore
              .getState()
              .memories[
              bot.name
            ];

          const lessons =
            memory?.lessons
              ?.slice(0, 5)
              ?.join("\n") ||
            "No lessons yet";

          const confidenceScore =
            memory?.confidenceScore ||
            50;

          /*
            Capital allocation
          */

          const capitalData =
            useCapitalStore
              .getState()
              .capitals.find(
                (
                  capital
                ) =>
                  capital.bot ===
                  bot.name
              );

          const allocatedCapital =
            capitalData
              ?.allocatedCapital ||
            100000;

          /*
            Asset summary
          */

          const assetSummary =
            assets
              .map(
                (
                  asset
                ) => `
${asset.symbol}
Price: ${asset.price}
Trend: ${asset.trend}
Volatility: ${asset.volatility}
Change: ${asset.change}
Volume: ${asset.volume}
`
              )
              .join("\n");

          /*
            AI Prompt
          */

          const prompt = `
You are an autonomous multi-asset AI hedge fund.

Goal:
maximize long-term profits while managing risk.

Global Market Regime:
${marketRegime}

Market Volatility:
${volatility}

RSI:
${rsi}

EMA:
${ema}

MACD:
${macdData.macd}

Signal:
${macdData.signal}

Supertrend:
${supertrend.trend}

Higher Timeframe:
${higherTimeframeTrend}

Trend Structure:
${structure.trend}

Momentum Strength:
${structure.momentum}

Breakout Detected:
${structure.breakout}

Support:
${structure.support}

Resistance:
${structure.resistance}

Candle Pattern:
${structure.candleSignal}

Allocated Capital:
${allocatedCapital}

Available Markets:
${assetSummary}

Your Lessons:
${lessons}

Confidence Calibration:
${confidenceScore}

IMPORTANT:

Choose the BEST market opportunity.

Respond ONLY in valid JSON.

{
  "symbol": "NIFTY or BANKNIFTY or SENSEX or FINNIFTY",

  "decision": "BUY or SELL or HOLD",

  "confidence": 0-100,

  "reason": "short reason"
}
`;

          /*
            Run AI
          */

          const rawResponse =
            await runAIProvider(
              bot.provider,
              prompt
            );

          const parsed =
            parseAIResponse(
              rawResponse
            );

          /*
            Find asset
          */

          const selectedAsset =
            assets.find(
              (asset) =>
                asset.symbol ===
                parsed.symbol
            );

          if (
            !selectedAsset
          ) {
            continue;
          }

          /*
            Save AI thought
          */

          useAIThoughtStore
            .getState()
            .addThought({
              bot:
                bot.name,

              thought:
                parsed.reason,

              confidence:
                parsed.confidence,

              marketRegime,

              action:
                parsed.decision,

              timestamp:
                new Date().toISOString(),
            });

          console.log(
            `${bot.name} Parsed:`,
            parsed
          );

          /*
            HOLD
          */

          if (
            parsed.decision ===
            "HOLD"
          ) {
            continue;
          }

          /*
            Risk sizing
          */

          const riskPercent =
            parsed.confidence >
            80
              ? 0.03
              : parsed.confidence >
                60
              ? 0.02
              : 0.01;

          const capitalRisk =
            allocatedCapital *
            riskPercent;

          let quantity =
            Math.floor(
              capitalRisk /
                selectedAsset.price
            );

          /*
            Reduce size in volatility
          */

          if (
            selectedAsset.volatility ===
            "HIGH"
          ) {

            quantity =
              Math.floor(
                quantity * 0.5
              );
          }

          quantity =
            Math.max(
              1,
              quantity
            );

          /*
            REAL PAPER ORDER
          */

          const {
            paperTrading,
          } =
            useBrokerStore.getState();

          if (paperTrading) {

            try {

              const broker =
                new UpstoxBroker();

              await broker.placeOrder({
                symbol:
                  selectedAsset.symbol,

                side:
                  parsed.decision,

                quantity,

                orderType:
                  "MARKET",

                product: "D",

                validity:
                  "DAY",
              });

              console.log(
                "REAL PAPER ORDER SENT"
              );

            } catch (
              brokerError
            ) {

              console.error(
                "Broker Execution Failed:",
                brokerError
              );
            }
          }

          /*
            Simulated execution
          */

          const execution =
            simulateExecution({
              side:
                parsed.decision,

              marketPrice:
                selectedAsset.price,

              quantity,

              volatility:
                selectedAsset.volatility,
            });

          const actualEntryPrice =
            execution.executedPrice;

          /*
            Stop loss / take profit
          */

          const stopLoss =
            parsed.decision ===
            "BUY"
              ? actualEntryPrice -
                atr * 1.2
              : actualEntryPrice +
                atr * 1.2;

          const takeProfit =
            parsed.decision ===
            "BUY"
              ? actualEntryPrice +
                atr * 2
              : actualEntryPrice -
                atr * 2;

          /*
            Open position
          */

          const created =
            usePositionStore
              .getState()
              .addPosition({
                id: Date.now(),

                bot:
                  bot.name,

                symbol:
                  selectedAsset.symbol,

                side:
                  parsed.decision,

                quantity,

                entryPrice:
                  actualEntryPrice,

                currentPrice:
                  actualEntryPrice,

                stopLoss:
                  Number(
                    stopLoss.toFixed(
                      2
                    )
                  ),

                takeProfit:
                  Number(
                    takeProfit.toFixed(
                      2
                    )
                  ),

                pnl: 0,

                status:
                  "OPEN",

                openedAt:
                  new Date().toISOString(),
              });

          if (!created) {
            continue;
          }

          /*
            Save execution analytics
          */

          useExecutionStore
            .getState()
            .addExecution({
              bot:
                bot.name,

              symbol:
                selectedAsset.symbol,

              side:
                parsed.decision,

              requestedPrice:
                selectedAsset.price,

              executedPrice:
                execution.executedPrice,

              slippage:
                execution.slippage,

              fees:
                execution.fees,

              latency:
                execution.latency,

              timestamp:
                new Date().toISOString(),
            });

          console.log(
            `${bot.name} OPENED ${selectedAsset.symbol}`
          );

          console.log(
            "Execution Details:",
            {
              executedPrice:
                execution.executedPrice,

              slippage:
                execution.slippage,

              fees:
                execution.fees,

              latency:
                execution.latency,
            }
          );

        } catch (botError) {

          console.error(
            `${bot.name} Error:`,
            botError
          );
        }
      }

      /*
        Leaderboard analytics
      */

      const leaderboard =
        bots.map((bot) => {

          const botTrades =
            trades.filter(
              (trade) =>
                trade.bot ===
                bot.name
            );

          const stats =
            calculateAdvancedStats(
              botTrades
            );

          useCapitalStore
            .getState()
            .updateBotCapital(
              bot.name,
              {
                pnl:
                  stats.totalPnL,

                winRate:
                  stats.winRate,

                sharpeLike:
                  stats.sharpeLike,
              }
            );

          return {
            bot: bot.name,

            ...stats,
          };
        });

      /*
        Capital rebalance
      */

      useCapitalStore
        .getState()
        .rebalanceCapital();

      leaderboard.sort(
        (a, b) => {

          if (
            b.sharpeLike !==
            a.sharpeLike
          ) {

            return (
              b.sharpeLike -
              a.sharpeLike
            );
          }

          return (
            b.totalPnL -
            a.totalPnL
          );
        }
      );

      useLeaderboardStore
        .getState()
        .setLeaderboard(
          leaderboard
        );

    } catch (error) {

      console.error(
        "AI Trading Error:",
        error
      );
    }
  }

  executeTradingCycle();

  setInterval(() => {
    executeTradingCycle();
  }, 15000);
}