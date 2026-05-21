import { useCandleStore } from "@/store/candleStore";

import { useIndicatorStore } from "@/store/indicatorStore";

import { useMarketRegimeStore } from "@/store/marketRegimeStore";

import { calculateRSI } from "@/lib/indicators/liveRSI";

import { calculateEMA } from "@/lib/indicators/liveEMA";

import { calculateMACD } from "@/lib/indicators/liveMACD";

import { calculateATR } from "@/lib/indicators/liveATR";

import { calculateBollingerBands } from "@/lib/indicators/liveBollinger";

import { calculateSupertrend } from "@/lib/indicators/liveSupertrend";

type Tick = {
  price: number;

  timestamp: number;
};

type Symbol =
  | "NIFTY"
  | "BANKNIFTY"
  | "SENSEX";

type CandleState = {
  open: number;

  high: number;

  low: number;

  close: number;

  time: number;
};

/*
  Per-symbol current candle state
*/

const currentCandles: Partial<
  Record<Symbol, CandleState>
> = {};

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
    Math.abs(macd - signal) > 20
  ) {
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

export function processTick(
  tick: Tick,
  symbol: Symbol = "NIFTY"
) {
  const candleDuration = 60 * 1000;

  const bucket =
    Math.floor(
      tick.timestamp / candleDuration
    ) * candleDuration;

  const current = currentCandles[symbol];

  /*
    First candle for this symbol
  */

  if (!current) {
    currentCandles[symbol] = {
      open: tick.price,

      high: tick.price,

      low: tick.price,

      close: tick.price,

      time: bucket,
    };

    return;
  }

  /*
    New candle minute boundary
  */

  if (bucket !== current.time) {
    const candle = {
      open: current.open,

      high: current.high,

      low: current.low,

      close: current.close,

      time: current.time,
    };

    const store = useCandleStore.getState();

    if (symbol === "NIFTY") {
      store.addNiftyCandle(candle);

      /*
        Indicators — NIFTY only
      */

      const candles = store.niftyCandles;

      if (candles.length > 35) {
        const rsi = calculateRSI(candles);

        const ema = calculateEMA(candles);

        const atr = calculateATR(candles);

        const macd = calculateMACD(candles);

        const bollinger =
          calculateBollingerBands(candles);

        const supertrend =
          calculateSupertrend(candles);

        useIndicatorStore
          .getState()
          .setIndicators({
            rsi,

            ema,

            atr,

            macd: macd.macd,

            macdSignal: macd.signal,

            macdHistogram: macd.histogram,

            supertrend: supertrend.trend,

            bollingerUpper: bollinger.upper,

            bollingerMiddle:
              bollinger.middle,

            bollingerLower: bollinger.lower,
          });

        const regime = detectMarketRegime({
          rsi,

          atr,

          macd: macd.macd,

          signal: macd.signal,

          trend: supertrend.trend,
        });

        const volatility =
          atr > 200
            ? "HIGH"
            : atr > 100
            ? "MEDIUM"
            : "LOW";

        let momentum = "NEUTRAL";

        if (macd.macd > macd.signal) {
          momentum = "BULLISH";
        }

        if (macd.macd < macd.signal) {
          momentum = "BEARISH";
        }

        const trendAlignment =
          regime.includes("TRENDING")
            ? "ALIGNED"
            : "MISALIGNED";

        const strength = Math.min(
          100,
          Math.abs(
            macd.macd - macd.signal
          ) + rsi
        );

        const summary = `
${regime} market with ${volatility} volatility and ${momentum} momentum.
Market strength currently at ${strength.toFixed(0)}/100.
`;

        useMarketRegimeStore
          .getState()
          .setMarketState({
            regime,

            volatility,

            trendAlignment,

            momentum,

            strength,

            summary,
          });

        console.log(
          "Market State Updated"
        );
      }
    } else if (symbol === "BANKNIFTY") {
      store.addBankniftyCandle(candle);
    } else if (symbol === "SENSEX") {
      store.addSensexCandle(candle);
    }

    console.log(
      `New Candle [${symbol}]:`,
      candle
    );

    /*
      Start next candle
    */

    currentCandles[symbol] = {
      open: tick.price,

      high: tick.price,

      low: tick.price,

      close: tick.price,

      time: bucket,
    };

    return;
  }

  /*
    Update live candle OHLC
  */

  current.high = Math.max(
    current.high,
    tick.price
  );

  current.low = Math.min(
    current.low,
    tick.price
  );

  current.close = tick.price;
}
