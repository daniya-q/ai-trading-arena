export async function fetchIndianMarketData() {
  try {
    const instrumentKeys =
      [
        "NSE_INDEX|Nifty 50",

        "NSE_INDEX|Nifty Bank",

        "BSE_INDEX|SENSEX",
      ]
        .map(encodeURIComponent)
        .join(",");

    const response =
      await fetch(
        `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${instrumentKeys}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN}`,

            Accept:
              "application/json",
          },
        }
      );

    const data =
      await response.json();

    console.log(
      "Market Data:",
      data
    );

    return data;
  } catch (error) {
    console.error(
      "Upstox Market Error:",
      error
    );

    return null;
  }
}