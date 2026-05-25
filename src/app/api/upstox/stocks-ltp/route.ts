import { NextResponse } from "next/server";

/*
  Top 10 Nifty 50 stocks by typical volume.
  Upstox instrument_key format: NSE_EQ|SYMBOL (pipe in param, colon in response key).
*/
const STOCKS = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "ICICIBANK",
  "HINDUNILVR",
  "ITC",
  "SBIN",
  "BHARTIARTL",
  "KOTAKBANK",
];

const INSTRUMENT_KEYS = STOCKS.map((s) => `NSE_EQ|${s}`);

export async function GET() {
  const accessToken = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;

  if (!accessToken) {
    return NextResponse.json(
      { error: "UPSTOX_ANALYTICS_TOKEN not set" },
      { status: 500 }
    );
  }

  const instrumentKey = INSTRUMENT_KEYS.map(encodeURIComponent).join(",");

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

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Upstox API error ${res.status}`, detail: text },
        { status: res.status }
      );
    }

    json = await res.json();
  } catch (err) {
    return NextResponse.json(
      { error: "Upstox stock LTP fetch failed", detail: String(err) },
      { status: 502 }
    );
  }

  const data = json?.data as
    | Record<string, { last_price?: number; close_price?: number }>
    | undefined;

  if (!data) {
    return NextResponse.json(
      { error: "No data in Upstox response", raw: json },
      { status: 502 }
    );
  }

  const stocks = STOCKS.map((symbol) => {
    /*
      Upstox response key uses colon separator: "NSE_EQ:RELIANCE"
    */
    const key = `NSE_EQ:${symbol}`;
    const quote = data[key];
    const price = Number((quote?.last_price ?? 0).toFixed(2));
    const close = Number((quote?.close_price ?? price).toFixed(2));
    const change = Number((price - close).toFixed(2));

    return { symbol, price, change };
  }).filter((s) => s.price > 0); // omit symbols with no data

  return NextResponse.json({ stocks });
}
