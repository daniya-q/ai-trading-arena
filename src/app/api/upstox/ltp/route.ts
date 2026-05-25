import { NextResponse } from "next/server";

const INSTRUMENT_KEYS = [
  "NSE_INDEX|Nifty 50",
  "NSE_INDEX|Nifty Bank",
  "BSE_INDEX|SENSEX",
];

/*
  Upstox LTP response keys use ":" separator,
  instrument_key param uses "|" separator.
*/
const KEY_TO_SYMBOL: Record<
  string,
  "NIFTY" | "BANKNIFTY" | "SENSEX"
> = {
  "NSE_INDEX:Nifty 50": "NIFTY",
  "NSE_INDEX:Nifty Bank": "BANKNIFTY",
  "BSE_INDEX:SENSEX": "SENSEX",
};

export async function GET() {
  const accessToken =
    process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;

  if (!accessToken) {
    return NextResponse.json(
      { error: "UPSTOX_ANALYTICS_TOKEN not set" },
      { status: 500 }
    );
  }

  const instrumentKey = INSTRUMENT_KEYS.map(
    encodeURIComponent
  ).join(",");

  let json: Record<string, unknown>;

  try {
    const res = await fetch(
      `https://api.upstox.com/v2/market-quote/ltp?instrument_key=${instrumentKey}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    json = await res.json();
  } catch (err) {
    return NextResponse.json(
      { error: "Upstox LTP fetch failed", detail: String(err) },
      { status: 502 }
    );
  }

  const data = json?.data as
    | Record<string, { last_price?: number }>
    | undefined;

  if (!data) {
    return NextResponse.json(
      { error: "No data in Upstox LTP response", raw: json },
      { status: 502 }
    );
  }

  const prices: Partial<
    Record<"NIFTY" | "BANKNIFTY" | "SENSEX", number>
  > = {};

  for (const [key, val] of Object.entries(data)) {
    const symbol = KEY_TO_SYMBOL[key];

    if (symbol && val?.last_price) {
      prices[symbol] = Number(
        val.last_price.toFixed(2)
      );
    }
  }

  return NextResponse.json({ prices });
}
