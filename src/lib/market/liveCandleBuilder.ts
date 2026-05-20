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

let currentCandle:
  | {
      open: number;

      high: number;

      low: number;

      close: number;

      time: number;
    }
  | undefined;

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

export function processTick(
  tick: Tick
) {
  const candleDuration =
    60 * 1000;

  const bucket =
    Math.floor(
      tick.timestamp /
        candleDuration
    ) * candleDuration;

  /*
    First candle
  */

  if (!currentCandle) {
    currentCandle = {
      open: tick.price,

      high: tick.price,

      low: tick.price,

      close: tick.price,

      time: bucket,
    };

    return;
  }

  /*
    New candle
  */

  if (
    bucket !==
    currentCandle.time
  ) {
    const candle = {
      open:
        currentCandle.open,

      high:
        currentCandle.high,

      low:
        currentCandle.low,

      close:
        currentCandle.close,

      time:
        currentCandle.time,
    };

    /*
      Store candle
    */

    useCandleStore
      .getState()
      .addNiftyCandle(
        candle
      );

    /*
      Get candles
    */

    const candles =
      useCandleStore
        .getState()
        .niftyCandles;

    /*
      Indicators
    */

    if (
      candles.length > 35
    ) {
      const rsi =
        calculateRSI(
          candles
        );

      const ema =
        calculateEMA(
          candles
        );

      const atr =
        calculateATR(
          candles
        );

      const macd =
        calculateMACD(
          candles
        );

      const bollinger =
        calculateBollingerBands(
          candles
        );

      const supertrend =
        calculateSupertrend(
          candles
        );

      /*
        Indicator store
      */

      useIndicatorStore
        .getState()
        .setIndicators({
          rsi,

          ema,

          atr,

          macd:
            macd.macd,

          macdSignal:
            macd.signal,

          macdHistogram:
            macd.histogram,

          supertrend:
            supertrend.trend,

          bollingerUpper:
            bollinger.upper,

          bollingerMiddle:
            bollinger.middle,

          bollingerLower:
            bollinger.lower,
        });

      /*
        Market regime
      */

      const regime =
        detectMarketRegime({
          rsi,

          atr,

          macd:
            macd.macd,

          signal:
            macd.signal,

          trend:
            supertrend.trend,
        });

      /*
        Volatility state
      */

      const volatility =
        atr > 200
          ? "HIGH"
          : atr > 100
          ? "MEDIUM"
          : "LOW";

      /*
        Momentum
      */

      let momentum =
        "NEUTRAL";

      if (
        macd.macd >
        macd.signal
      ) {
        momentum =
          "BULLISH";
      }

      if (
        macd.macd <
        macd.signal
      ) {
        momentum =
          "BEARISH";
      }

      /*
        Trend alignment
      */

      const trendAlignment =
        regime.includes(
          "TRENDING"
        )
          ? "ALIGNED"
          : "MISALIGNED";

      /*
        Market strength
      */

      const strength =
        Math.min(
          100,

          Math.abs(
            macd.macd -
              macd.signal
          ) +
            rsi
        );

      /*
        Market summary
      */

      const summary = `
${regime} market with ${volatility} volatility and ${momentum} momentum.
Market strength currently at ${strength.toFixed(
        0
      )}/100.
`;

      /*
        Broadcast market state
      */

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

    console.log(
      "New Candle:",
      candle
    );

    /*
      Start next candle
    */

    currentCandle = {
      open: tick.price,

      high: tick.price,

      low: tick.price,

      close: tick.price,

      time: bucket,
    };

    return;
  }

  /*
    Update live candle
  */

  currentCandle.high =
    Math.max(
      currentCandle.high,
      tick.price
    );

  currentCandle.low =
    Math.min(
      currentCandle.low,
      tick.price
    );

  currentCandle.close =
    tick.price;
}