import { bots } from "@/data/bots";

import { useBacktestStore } from "@/store/backtestStore";

export async function runBacktest() {

  const store =
    useBacktestStore.getState();

  store.reset();

  store.setRunning(true);

  /*
    Simulated historical candles
  */

  const historicalPrices =
    Array.from(
      { length: 300 },
      (_, i) =>
        24000 +
        Math.sin(i / 10) *
          500 +
        Math.random() * 200
    );

  /*
    Bot equity tracking
  */

  const botStats:
    Record<
      string,
      {
        pnl: number;

        wins: number;

        trades: number;

        equity: number[];

        peak: number;

        maxDrawdown: number;
      }
    > = {};

  bots.forEach(
    (bot) => {
      botStats[
        bot.name
      ] = {
        pnl: 0,

        wins: 0,

        trades: 0,

        equity: [0],

        peak: 0,

        maxDrawdown: 0,
      };
    }
  );

  /*
    Candle replay
  */

  for (
    let i = 30;
    i <
    historicalPrices.length -
      5;
    i++
  ) {
    const current =
      historicalPrices[i];

    const next =
      historicalPrices[
        i + 5
      ];

    for (const bot of bots) {

      /*
        Randomized AI behavior simulation
      */

      const side =
        Math.random() >
        0.5
          ? "BUY"
          : "SELL";

      let pnl = 0;

      if (
        side === "BUY"
      ) {
        pnl =
          next - current;
      } else {
        pnl =
          current - next;
      }

      pnl =
        Number(
          (
            pnl *
            (
              Math.random() *
                3 +
              1
            )
          ).toFixed(2)
        );

      /*
        Save trade
      */

      store.addTrade({
        bot:
          bot.name,

        symbol:
          "NIFTY",

        side,

        entry: current,

        exit: next,

        pnl,

        timestamp:
          new Date().toISOString(),
      });

      /*
        Stats
      */

      const stats =
        botStats[
          bot.name
        ];

      stats.pnl += pnl;

      stats.trades += 1;

      if (pnl > 0) {
        stats.wins += 1;
      }

      stats.equity.push(
        stats.pnl
      );

      /*
        Drawdown
      */

      if (
        stats.pnl >
        stats.peak
      ) {
        stats.peak =
          stats.pnl;
      }

      const drawdown =
        stats.peak -
        stats.pnl;

      if (
        drawdown >
        stats.maxDrawdown
      ) {
        stats.maxDrawdown =
          drawdown;
      }
    }

    /*
      Replay speed
    */

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          20
        )
    );
  }

  /*
    Final analytics
  */

  const results =
    bots.map((bot) => {
      const stats =
        botStats[
          bot.name
        ];

      const avgPnL =
        stats.pnl /
        Math.max(
          stats.trades,
          1
        );

      return {
        bot:
          bot.name,

        totalPnL:
          Number(
            stats.pnl.toFixed(
              2
            )
          ),

        winRate:
          Number(
            (
              (stats.wins /
                stats.trades) *
              100
            ).toFixed(1)
          ),

        trades:
          stats.trades,

        maxDrawdown:
          Number(
            stats.maxDrawdown.toFixed(
              2
            )
          ),

        sharpeLike:
          Number(
            avgPnL.toFixed(
              2
            )
          ),
      };
    });

  store.setResults(
    results
  );

  store.setRunning(false);

  console.log(
    "Backtest Completed"
  );
}