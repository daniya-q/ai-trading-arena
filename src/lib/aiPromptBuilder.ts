type PromptInput = {
  symbol: string;

  currentPrice: number;

  signal: string;

  confidence: number;

  trend: string;

  volatility: string;

  multiTimeframe: {
    finalSignal: string;

    overallTrend: string;

    alignment: number;
  };
};

export function buildTradingPrompt({
  symbol,
  currentPrice,
  signal,
  confidence,
  trend,
  volatility,
  multiTimeframe,
}: PromptInput) {
  return `
You are an elite institutional trader.

Analyze the following market setup and decide whether to BUY, SELL, or HOLD.

Market Data:
- Symbol: ${symbol}
- Current Price: ${currentPrice}

Signal Engine:
- Signal: ${signal}
- Confidence: ${confidence}%
- Trend: ${trend}
- Volatility: ${volatility}

Multi-Timeframe Analysis:
- Final Signal: ${multiTimeframe.finalSignal}
- Overall Trend: ${multiTimeframe.overallTrend}
- Alignment: ${multiTimeframe.alignment}%

Rules:
- Only take high conviction trades.
- Avoid trading during weak alignment.
- Consider volatility before taking aggressive positions.
- Reply ONLY in JSON format.

Required JSON format:
{
  "decision": "BUY or SELL or HOLD",
  "confidence": number,
  "reason": "short explanation",
  "positionSize": number
}
`;
}