type Trade = {
  id: number;

  bot: string;

  symbol: string;

  side: string;

  quantity: number;

  entryPrice: number;

  currentPrice: number;

  pnl: number;

  status: string;

  timestamp: string;
};

export function calculateAdvancedStats(
  trades: Trade[]
) {
  if (
    trades.length === 0
  ) {
    return {
      totalTrades: 0,

      winRate: 0,

      avgPnL: 0,

      totalPnL: 0,

      profitFactor: 0,

      maxDrawdown: 0,

      expectancy: 0,

      sharpeLike: 0,
    };
  }

  /*
    Winners / losers
  */

  const winningTrades =
    trades.filter(
      (trade) =>
        trade.pnl > 0
    );

  const losingTrades =
    trades.filter(
      (trade) =>
        trade.pnl < 0
    );

  /*
    Total pnl
  */

  const totalPnL =
    trades.reduce(
      (
        sum,
        trade
      ) =>
        sum + trade.pnl,
      0
    );

  /*
    Average pnl
  */

  const avgPnL =
    totalPnL /
    trades.length;

  /*
    Gross profit / loss
  */

  const grossProfit =
    winningTrades.reduce(
      (
        sum,
        trade
      ) =>
        sum + trade.pnl,
      0
    );

  const grossLoss =
    Math.abs(
      losingTrades.reduce(
        (
          sum,
          trade
        ) =>
          sum + trade.pnl,
        0
      )
    );

  /*
    Profit factor
  */

  const profitFactor =
    grossLoss === 0
      ? grossProfit
      : grossProfit /
        grossLoss;

  /*
    Win rate
  */

  const winRate =
    (winningTrades.length /
      trades.length) *
    100;

  /*
    Max drawdown
  */

  let peak = 0;

  let runningPnL = 0;

  let maxDrawdown = 0;

  trades.forEach(
    (trade) => {
      runningPnL +=
        trade.pnl;

      if (
        runningPnL > peak
      ) {
        peak = runningPnL;
      }

      const drawdown =
        peak -
        runningPnL;

      if (
        drawdown >
        maxDrawdown
      ) {
        maxDrawdown =
          drawdown;
      }
    }
  );

  /*
    Expectancy
  */

  const avgWin =
    winningTrades.length >
    0
      ? grossProfit /
        winningTrades.length
      : 0;

  const avgLoss =
    losingTrades.length >
    0
      ? grossLoss /
        losingTrades.length
      : 0;

  const expectancy =
    (winRate / 100) *
      avgWin -
    ((100 - winRate) /
      100) *
      avgLoss;

  /*
    Sharpe-like score
  */

  const variance =
    trades.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        Math.pow(
          trade.pnl -
            avgPnL,
          2
        ),
      0
    ) /
    trades.length;

  const stdDev =
    Math.sqrt(
      variance
    );

  const sharpeLike =
    stdDev === 0
      ? 0
      : avgPnL /
        stdDev;

  /*
    Final output
  */

  return {
    totalTrades:
      trades.length,

    winRate:
      Number(
        winRate.toFixed(
          2
        )
      ),

    avgPnL:
      Number(
        avgPnL.toFixed(
          2
        )
      ),

    totalPnL:
      Number(
        totalPnL.toFixed(
          2
        )
      ),

    profitFactor:
      Number(
        profitFactor.toFixed(
          2
        )
      ),

    maxDrawdown:
      Number(
        maxDrawdown.toFixed(
          2
        )
      ),

    expectancy:
      Number(
        expectancy.toFixed(
          2
        )
      ),

    sharpeLike:
      Number(
        sharpeLike.toFixed(
          2
        )
      ),
  };
}