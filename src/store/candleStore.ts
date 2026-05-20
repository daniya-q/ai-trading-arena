import { create } from "zustand";

export type Candle = {
  time: number;

  open: number;

  high: number;

  low: number;

  close: number;
};

type CandleState = {
  niftyCandles: Candle[];

  bankniftyCandles: Candle[];

  sensexCandles: Candle[];

  addNiftyCandle: (
    candle: Candle
  ) => void;

  addBankniftyCandle: (
    candle: Candle
  ) => void;

  addSensexCandle: (
    candle: Candle
  ) => void;
};

export const useCandleStore =
  create<CandleState>(
    (set) => ({
      niftyCandles: [],

      bankniftyCandles: [],

      sensexCandles: [],

      addNiftyCandle: (
        candle
      ) =>
        set((state) => ({
          niftyCandles: [
            ...state.niftyCandles.slice(
              -99
            ),

            candle,
          ],
        })),

      addBankniftyCandle:
        (candle) =>
          set((state) => ({
            bankniftyCandles:
              [
                ...state.bankniftyCandles.slice(
                  -99
                ),

                candle,
              ],
          })),

      addSensexCandle:
        (candle) =>
          set((state) => ({
            sensexCandles:
              [
                ...state.sensexCandles.slice(
                  -99
                ),

                candle,
              ],
          })),
    })
  );