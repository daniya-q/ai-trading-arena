import { trades } from "@/data/trades";
import { positions } from "@/data/positions";

type TradeSide = "BUY" | "SELL";

type TradeInput = {
  bot: string;

  symbol: string;

  side: TradeSide;

  quantity: number;

  entryPrice: number;
};

export function executeTrade({
  bot,
  symbol,
  side,
  quantity,
  entryPrice,
}: TradeInput) {
  const newTrade = {
    id: trades.length + 1,

    bot,

    symbol,

    side,

    quantity,

    entryPrice,

    currentPrice: entryPrice,

    pnl: 0,

    status: "OPEN",

    timestamp: new Date().toLocaleTimeString(),
  };

  trades.unshift(newTrade);

  const newPosition = {
    id: positions.length + 1,

    bot,

    symbol,

    side,

    quantity,

    averageEntry: entryPrice,

    currentPrice: entryPrice,

    unrealizedPnL: 0,

    status: "OPEN",
  };

  positions.unshift(newPosition);

  return {
    success: true,

    trade: newTrade,

    position: newPosition,
  };
}

export function updatePositionPrices(
  symbol: string,
  newPrice: number
) {
  positions.forEach((position) => {
    if (position.symbol === symbol) {
      position.currentPrice = newPrice;

      const pnl =
        position.side === "BUY"
          ? (newPrice -
              position.averageEntry) *
            position.quantity
          : (position.averageEntry -
              newPrice) *
            position.quantity;

      position.unrealizedPnL =
        Number(pnl.toFixed(2));
    }
  });
}