export type OptionStrike = {
  strike: number;
  cePremium: number;
  pePremium: number;
  ceOI: number;
  peOI: number;
  /** Average of CE IV and PE IV */
  iv: number;
};

export type OptionChainResult = {
  spotPrice: number;
  atmStrike: number;
  strikes: OptionStrike[];
};

/**
 * Fetches the option chain for a given instrument and expiry date.
 * Calls /api/upstox/option-chain which returns ATM ±10 strikes.
 *
 * @param instrument - "NIFTY" | "BANKNIFTY" | "SENSEX"
 * @param expiry     - Expiry date in YYYY-MM-DD format
 */
export async function fetchOptionChain(
  instrument: string,
  expiry: string
): Promise<OptionChainResult> {
  const res = await fetch(
    `/api/upstox/option-chain?instrument=${encodeURIComponent(instrument)}&expiry=${encodeURIComponent(expiry)}`
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Option chain fetch failed (${res.status}): ${body.error ?? res.statusText}`
    );
  }

  const json = await res.json() as {
    spotPrice: number;
    atmStrike: number;
    strikes: Array<{
      strike: number;
      ce: { premium: number; oi: number; iv: number };
      pe: { premium: number; oi: number; iv: number };
    }>;
  };

  const strikes: OptionStrike[] = (json.strikes ?? []).map((row) => ({
    strike: row.strike,
    cePremium: row.ce.premium,
    pePremium: row.pe.premium,
    ceOI: row.ce.oi,
    peOI: row.pe.oi,
    iv: Number(((row.ce.iv + row.pe.iv) / 2).toFixed(2)),
  }));

  return {
    spotPrice: json.spotPrice ?? 0,
    atmStrike: json.atmStrike ?? 0,
    strikes,
  };
}
