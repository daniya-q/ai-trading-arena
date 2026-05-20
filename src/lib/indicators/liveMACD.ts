import { Candle } from "@/store/candleStore";

function calculateEMAValues(
  values: number[],
  period: number
) {
  const multiplier =
    2 / (period + 1);

  let ema =
    values[0];

  const emaValues = [ema];

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    ema =
      (values[i] -
        ema) *
        multiplier +
      ema;

    emaValues.push(ema);
  }

  return emaValues;
}

export function calculateMACD(
  candles: Candle[]
) {
  if (
    candles.length < 35
  ) {
    return {
      macd: 0,

      signal: 0,

      histogram: 0,
    };
  }

  const closes =
    candles.map(
      (candle) =>
        candle.close
    );

  const ema12 =
    calculateEMAValues(
      closes,
      12
    );

  const ema26 =
    calculateEMAValues(
      closes,
      26
    );

  const macdLine =
    ema12.map(
      (value, index) =>
        value -
        ema26[index]
    );

  const signalLine =
    calculateEMAValues(
      macdLine,
      9
    );

  const macd =
    macdLine[
      macdLine.length - 1
    ];

  const signal =
    signalLine[
      signalLine.length -
        1
    ];

  const histogram =
    macd - signal;

  return {
    macd: Number(
      macd.toFixed(2)
    ),

    signal: Number(
      signal.toFixed(2)
    ),

    histogram: Number(
      histogram.toFixed(2)
    ),
  };
}