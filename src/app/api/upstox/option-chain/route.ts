import { NextRequest, NextResponse } from "next/server";

// Upstox instrument keys for index options
const INSTRUMENT_KEYS: Record<string, string> = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  SENSEX: "BSE_INDEX|SENSEX",
};

// ATM window: ±10 strikes either side
const ATM_WINDOW = 10;

interface UpstoxMarketData {
  ltp?: number;
  oi?: number;
  volume?: number;
  close_price?: number;
}

interface UpstoxOptionGreeks {
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

interface UpstoxOptionLeg {
  instrument_key?: string;
  market_data?: UpstoxMarketData;
  option_greeks?: UpstoxOptionGreeks;
}

interface UpstoxChainRow {
  expiry?: string;
  strike_price: number;
  underlying_spot_price?: number;
  call_options?: UpstoxOptionLeg;
  put_options?: UpstoxOptionLeg;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const instrument = searchParams.get("instrument")?.toUpperCase();
  const expiry = searchParams.get("expiry"); // YYYY-MM-DD

  if (!instrument || !expiry) {
    return NextResponse.json(
      { error: "Query params 'instrument' and 'expiry' are required" },
      { status: 400 }
    );
  }

  const instrumentKey = INSTRUMENT_KEYS[instrument];
  if (!instrumentKey) {
    return NextResponse.json(
      { error: `Unknown instrument: ${instrument}. Valid values: NIFTY, BANKNIFTY, SENSEX` },
      { status: 400 }
    );
  }

  const token = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "UPSTOX_ANALYTICS_TOKEN is not configured" },
      { status: 500 }
    );
  }

  // Build Upstox option chain URL
  const url = new URL("https://api.upstox.com/v2/option/chain");
  url.searchParams.set("instrument_key", instrumentKey);
  url.searchParams.set("expiry_date", expiry);

  let json: { status?: string; data?: UpstoxChainRow[] };

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

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
      { error: "Option chain fetch failed", detail: String(err) },
      { status: 502 }
    );
  }

  const chain = json.data ?? [];

  if (chain.length === 0) {
    return NextResponse.json({ spotPrice: 0, atmStrike: 0, strikes: [] });
  }

  // Spot price from first row (all rows share the same underlying price)
  const spotPrice = chain[0].underlying_spot_price ?? 0;

  // Find ATM strike: the strike closest to spot
  const atmStrike = chain.reduce<number>((nearest, row) => {
    return Math.abs(row.strike_price - spotPrice) <
      Math.abs(nearest - spotPrice)
      ? row.strike_price
      : nearest;
  }, chain[0].strike_price);

  // Sort all strikes ascending and slice ATM ±10
  const sortedStrikes = [...chain].sort(
    (a, b) => a.strike_price - b.strike_price
  );
  const atmIndex = sortedStrikes.findIndex(
    (row) => row.strike_price === atmStrike
  );
  const lo = Math.max(0, atmIndex - ATM_WINDOW);
  const hi = Math.min(sortedStrikes.length - 1, atmIndex + ATM_WINDOW);
  const window = sortedStrikes.slice(lo, hi + 1);

  const strikes = window.map((row) => ({
    strike: row.strike_price,
    ce: {
      premium: row.call_options?.market_data?.ltp ?? 0,
      oi: row.call_options?.market_data?.oi ?? 0,
      iv: row.call_options?.option_greeks?.iv ?? 0,
    },
    pe: {
      premium: row.put_options?.market_data?.ltp ?? 0,
      oi: row.put_options?.market_data?.oi ?? 0,
      iv: row.put_options?.option_greeks?.iv ?? 0,
    },
  }));

  return NextResponse.json({ spotPrice, atmStrike, strikes });
}
