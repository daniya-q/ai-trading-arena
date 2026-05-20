type Candle = {
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function calculateVWAP(
  candles: Candle[]
) {
  if (!candles.length) {
    return 0;
  }

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  candles.forEach((candle) => {
    const typicalPrice =
      (candle.high +
        candle.low +
        candle.close) /
      3;

    cumulativeTPV +=
      typicalPrice *
      candle.volume;

    cumulativeVolume +=
      candle.volume;
  });

  const vwap =
    cumulativeTPV /
    cumulativeVolume;

  return Number(
    vwap.toFixed(2)
  );
}