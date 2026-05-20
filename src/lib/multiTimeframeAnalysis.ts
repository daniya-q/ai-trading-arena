type TimeframeSignal = {
  timeframe: string;

  signal: string;

  confidence: number;

  trend: string;
};

export function analyzeMultiTimeframe(
  signals: TimeframeSignal[]
) {
  let bullish = 0;

  let bearish = 0;

  let totalConfidence = 0;

  signals.forEach((signal) => {
    totalConfidence +=
      signal.confidence;

    if (
      signal.trend ===
      "bullish"
    ) {
      bullish++;
    }

    if (
      signal.trend ===
      "bearish"
    ) {
      bearish++;
    }
  });

  let overallTrend =
    "neutral";

  if (bullish > bearish) {
    overallTrend =
      "bullish";
  }

  if (bearish > bullish) {
    overallTrend =
      "bearish";
  }

  const averageConfidence =
    totalConfidence /
    signals.length;

  /*
    Multi-timeframe agreement
  */

  const alignment =
    Math.max(
      bullish,
      bearish
    ) / signals.length;

  /*
    Final signal
  */

  let finalSignal =
    "HOLD";

  if (
    overallTrend ===
      "bullish" &&
    alignment >= 0.6
  ) {
    finalSignal = "BUY";
  }

  if (
    overallTrend ===
      "bearish" &&
    alignment >= 0.6
  ) {
    finalSignal = "SELL";
  }

  return {
    finalSignal,

    overallTrend,

    averageConfidence:
      Number(
        averageConfidence.toFixed(
          2
        )
      ),

    alignment: Number(
      (
        alignment * 100
      ).toFixed(2)
    ),

    bullishTimeframes:
      bullish,

    bearishTimeframes:
      bearish,
  };
}