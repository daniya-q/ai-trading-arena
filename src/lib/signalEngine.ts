type SignalInput = {
  rsi: number;

  ema: number;

  vwap: number;

  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };

  supertrend: {
    trend: string;
    value: number;
  };

  atr: number;

  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
  };

  currentPrice: number;
};

export function generateSignal({
  rsi,
  ema,
  vwap,
  macd,
  supertrend,
  atr,
  bollingerBands,
  currentPrice,
}: SignalInput) {
  let bullishScore = 0;

  let bearishScore = 0;

  /*
    RSI
  */

  if (rsi > 60) {
    bullishScore += 2;
  }

  if (rsi < 40) {
    bearishScore += 2;
  }

  /*
    EMA
  */

  if (currentPrice > ema) {
    bullishScore += 2;
  } else {
    bearishScore += 2;
  }

  /*
    VWAP
  */

  if (currentPrice > vwap) {
    bullishScore += 2;
  } else {
    bearishScore += 2;
  }

  /*
    MACD
  */

  if (macd.histogram > 0) {
    bullishScore += 2;
  } else {
    bearishScore += 2;
  }

  /*
    Supertrend
  */

  if (
    supertrend.trend ===
    "bullish"
  ) {
    bullishScore += 3;
  }

  if (
    supertrend.trend ===
    "bearish"
  ) {
    bearishScore += 3;
  }

  /*
    Bollinger Bands
  */

  if (
    currentPrice >
    bollingerBands.upper
  ) {
    bearishScore += 1;
  }

  if (
    currentPrice <
    bollingerBands.lower
  ) {
    bullishScore += 1;
  }

  /*
    Final Decision
  */

  let signal = "HOLD";

  if (
    bullishScore >= 7
  ) {
    signal = "BUY";
  }

  if (
    bearishScore >= 7
  ) {
    signal = "SELL";
  }

  /*
    Confidence
  */

  const confidence =
    Math.max(
      bullishScore,
      bearishScore
    ) * 10;

  /*
    Volatility
  */

  let volatility =
    "moderate";

  if (atr > 50) {
    volatility = "high";
  }

  if (atr < 20) {
    volatility = "low";
  }

  return {
    signal,

    confidence,

    bullishScore,

    bearishScore,

    volatility,

    trend:
      bullishScore >
      bearishScore
        ? "bullish"
        : bearishScore >
          bullishScore
        ? "bearish"
        : "neutral",
  };
}