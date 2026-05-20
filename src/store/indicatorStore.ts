import { create } from "zustand";

type IndicatorState = {
  rsi: number;

  ema: number;

  atr: number;

  macd: number;

  macdSignal: number;

  macdHistogram: number;

  supertrend: string;

  bollingerUpper: number;

  bollingerMiddle: number;

  bollingerLower: number;

  setIndicators: (
    indicators: Partial<IndicatorState>
  ) => void;
};

export const useIndicatorStore =
  create<IndicatorState>(
    (set) => ({
      rsi: 0,

      ema: 0,

      atr: 0,

      macd: 0,

      macdSignal: 0,

      macdHistogram: 0,

      supertrend:
        "NEUTRAL",

      bollingerUpper: 0,

      bollingerMiddle: 0,

      bollingerLower: 0,

      setIndicators: (
        indicators
      ) =>
        set(
          indicators
        ),
    })
  );