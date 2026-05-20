export function calculateBollingerBands(
  prices: number[],
  period = 20,
  multiplier = 2
) {
  if (prices.length < period) {
    return {
      upper: 0,
      middle: 0,
      lower: 0,
    };
  }

  const recentPrices =
    prices.slice(-period);

  const sma =
    recentPrices.reduce(
      (sum, price) =>
        sum + price,
      0
    ) / period;

  const variance =
    recentPrices.reduce(
      (sum, price) =>
        sum +
        Math.pow(
          price - sma,
          2
        ),
      0
    ) / period;

  const standardDeviation =
    Math.sqrt(
      variance
    );

  const upper =
    sma +
    multiplier *
      standardDeviation;

  const lower =
    sma -
    multiplier *
      standardDeviation;

  return {
    upper: Number(
      upper.toFixed(2)
    ),

    middle: Number(
      sma.toFixed(2)
    ),

    lower: Number(
      lower.toFixed(2)
    ),
  };
}