type ExecutionInput = {
  side: string;

  marketPrice: number;

  quantity: number;

  volatility: string;
};

type ExecutionResult = {
  executedPrice: number;

  slippage: number;

  fees: number;

  latency: number;
};

export function simulateExecution({
  side,
  marketPrice,
  quantity,
  volatility,
}: ExecutionInput): ExecutionResult {

  /*
    Spread simulation
  */

  let spread =
    marketPrice * 0.0002;

  /*
    Volatility adjustment
  */

  if (
    volatility ===
    "HIGH"
  ) {
    spread *= 3;
  }

  if (
    volatility ===
    "MEDIUM"
  ) {
    spread *= 1.5;
  }

  /*
    Slippage simulation
  */

  const slippagePercent =
    Math.random() *
    0.0015;

  const slippage =
    marketPrice *
    slippagePercent;

  /*
    Buy worse fill
    Sell worse fill
  */

  const executedPrice =
    side === "BUY"
      ? marketPrice +
        spread +
        slippage
      : marketPrice -
        spread -
        slippage;

  /*
    Institutional-style fees
  */

  const fees =
    executedPrice *
    quantity *
    0.0005;

  /*
    Latency simulation
  */

  const latency =
    Math.floor(
      Math.random() *
        300
    ) + 50;

  return {
    executedPrice:
      Number(
        executedPrice.toFixed(
          2
        )
      ),

    slippage:
      Number(
        slippage.toFixed(
          2
        )
      ),

    fees: Number(
      fees.toFixed(2)
    ),

    latency,
  };
}