export type BrokerOrder = {
  symbol: string;

  side: "BUY" | "SELL";

  quantity: number;

  orderType: "MARKET";

  product: "D";

  validity: "DAY";
};

export type BrokerPosition = {
  symbol: string;

  quantity: number;

  pnl: number;
};

export interface BrokerAdapter {
  placeOrder(
    order: BrokerOrder
  ): Promise<any>;

  getPositions(): Promise<
    BrokerPosition[]
  >;

  getBalance(): Promise<any>;
}