import { executeTrade } from "@/lib/trading/tradingEngine";

import { marketData } from "@/data/market";

const bots = [
  "ChatGPT",
  "Claude",
  "Gemini",
  "Groq",
];

const symbols = [
  "BANKNIFTY 52000 CE",
  "NIFTY 24500 PE",
  "RELIANCE",
  "TCS",
  "INFY",
];

function randomSide() {
  return Math.random() > 0.5
    ? "BUY"
    : "SELL";
}

function randomSymbol() {
  return symbols[
    Math.floor(
      Math.random() * symbols.length
    )
  ];
}

function randomQuantity() {
  return Math.floor(
    Math.random() * 5
  ) + 1;
}

function getRandomPrice() {
  const stock =
    marketData.stocks[
      Math.floor(
        Math.random() *
          marketData.stocks.length
      )
    ];

  return stock.price;
}

export function startAgentTrading() {
  setInterval(() => {
    const bot =
      bots[
        Math.floor(
          Math.random() * bots.length
        )
      ];

    const symbol = randomSymbol();

    const side = randomSide() as
      | "BUY"
      | "SELL";

    const quantity =
      randomQuantity();

    const entryPrice =
      getRandomPrice();

    executeTrade({
      bot,
      symbol,
      side,
      quantity,
      entryPrice,
    });

    console.log(
      `${bot} executed ${side} on ${symbol}`
    );
  }, 7000);
}