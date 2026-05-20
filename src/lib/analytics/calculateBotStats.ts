type Trade = {
  bot: string;

  pnl: number;
};

export function calculateBotStats(
  trades: Trade[],

  botName: string
) {
  /*
    Filter bot trades
  */

  const botTrades =
    trades.filter(
      (trade) =>
        trade.bot ===
        botName
    );

  /*
    No trades
  */

  if (
    botTrades.length === 0
  ) {
    return {
      totalPnL: 0,

      totalTrades: 0,

      wins: 0,

      losses: 0,

      winRate: 0,

      averagePnL: 0,

      maxWin: 0,

      maxLoss: 0,
    };
  }

  /*
    Total PnL
  */

  const totalPnL =
    botTrades.reduce(
      (sum, trade) =>
        sum + trade.pnl,
      0
    );

  /*
    Wins / losses
  */

  const wins =
    botTrades.filter(
      (trade) =>
        trade.pnl > 0
    ).length;

  const losses =
    botTrades.filter(
      (trade) =>
        trade.pnl <= 0
    ).length;

  /*
    Win rate
  */

  const winRate =
    (wins /
      botTrades.length) *
    100;

  /*
    Average PnL
  */

  const averagePnL =
    totalPnL /
    botTrades.length;

  /*
    Best / worst trade
  */

  const pnlValues =
    botTrades.map(
      (trade) =>
        trade.pnl
    );

  const maxWin =
    Math.max(
      ...pnlValues
    );

  const maxLoss =
    Math.min(
      ...pnlValues
    );

  return {
    totalPnL:
      Number(
        totalPnL.toFixed(2)
      ),

    totalTrades:
      botTrades.length,

    wins,

    losses,

    winRate:
      Number(
        winRate.toFixed(2)
      ),

    averagePnL:
      Number(
        averagePnL.toFixed(
          2
        )
      ),

    maxWin:
      Number(
        maxWin.toFixed(2)
      ),

    maxLoss:
      Number(
        maxLoss.toFixed(2)
      ),
  };
}