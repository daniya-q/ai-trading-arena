"use client";

import { useEffect, useState } from "react";

import { useLiveMarketStore } from "@/store/liveMarketStore";

import {
  getUpcomingExpiries,
  getDTE,
} from "@/lib/market/expiryCalendar";

import {
  startMarketWebSocket,
  startRestPolling,
} from "@/lib/upstox/startMarketWebSocket";

type Stock = {
  symbol: string;
  price: number;
  change: number;
};

type ExpiryInfo = {
  date: Date;
  dte: number;
};

// ── IST helpers (same logic as home page) ────────────────────

function getISTDate(): Date {
  const now = new Date();
  const utcMs =
    now.getTime() +
    now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 60 * 60 * 1000);
}

function getMarketStatus(): {
  isOpen: boolean;
  timeUntilOpen: string;
} {
  const ist = getISTDate();
  const day = ist.getDay();
  const totalMin =
    ist.getHours() * 60 + ist.getMinutes();
  const openMin = 9 * 60 + 15;
  const closeMin = 15 * 60 + 30;
  const isWeekday = day >= 1 && day <= 5;
  const isOpen =
    isWeekday &&
    totalMin >= openMin &&
    totalMin < closeMin;

  if (isOpen) return { isOpen: true, timeUntilOpen: "" };

  let minsUntil = 0;

  if (isWeekday && totalMin < openMin) {
    minsUntil = openMin - totalMin;
  } else {
    const daysAhead =
      day === 5 && totalMin >= closeMin
        ? 3
        : day === 6
        ? 2
        : day === 0
        ? 1
        : 1;

    minsUntil =
      24 * 60 -
      totalMin +
      (daysAhead - 1) * 24 * 60 +
      openMin;
  }

  const d = Math.floor(minsUntil / (24 * 60));
  const h = Math.floor((minsUntil % (24 * 60)) / 60);
  const m = minsUntil % 60;

  let s = "";
  if (d > 0) s += `${d}d `;
  if (h > 0 || d > 0) s += `${h}h `;
  s += `${m}m`;

  return { isOpen: false, timeUntilOpen: s.trim() };
}

function formatExpiry(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatPrice(n: number): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Component ─────────────────────────────────────────────────

export default function MarketPage() {

  const { nifty, banknifty, sensex } =
    useLiveMarketStore();

  const [marketStatus, setMarketStatus] =
    useState(getMarketStatus);

  const [expiries, setExpiries] =
    useState<{
      nifty: ExpiryInfo[];
      banknifty: ExpiryInfo[];
      sensex: ExpiryInfo[];
    }>({
      nifty: [],
      banknifty: [],
      sensex: [],
    });

  const [stocks, setStocks] =
    useState<Stock[]>([]);

  const [stocksLoading, setStocksLoading] =
    useState(true);

  const [stocksError, setStocksError] =
    useState<string | null>(null);

  async function fetchStocks() {

    try {

      const backendUrl =
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        "https://ai-trading-arena-backend-production.up.railway.app";

      const res = await fetch(
        `${backendUrl}/api/stocks-ltp`
      );

      const json = await res.json();

      if (json.stocks) {
        setStocks(json.stocks);
        setStocksError(null);
      } else {
        setStocksError(
          json.error || "No data returned"
        );
      }

    } catch (err) {

      setStocksError(String(err));

    } finally {

      setStocksLoading(false);

    }

  }

  useEffect(() => {

    // Start market feeds if not already running
    startMarketWebSocket();
    startRestPolling();

    // Market status refresh
    const statusInterval =
      setInterval(() => {
        setMarketStatus(getMarketStatus());
      }, 30000);

    // Expiry dates (one-time fetch — they only change weekly)
    Promise.all([
      getUpcomingExpiries("NIFTY"),
      getUpcomingExpiries("BANKNIFTY"),
      getUpcomingExpiries("SENSEX"),
    ]).then(
      ([niftyDates, bankniftyDates, sensexDates]) => {
        setExpiries({
          nifty: niftyDates.map((d) => ({
            date: d,
            dte: getDTE(d),
          })),
          banknifty: bankniftyDates.map((d) => ({
            date: d,
            dte: getDTE(d),
          })),
          sensex: sensexDates.map((d) => ({
            date: d,
            dte: getDTE(d),
          })),
        });
      }
    );

    // Stocks LTP
    fetchStocks();
    const stockInterval =
      setInterval(fetchStocks, 30000);

    return () => {
      clearInterval(statusInterval);
      clearInterval(stockInterval);
    };

  }, []);

  return (
    <div className="flex-1 p-8 bg-black min-h-screen text-white fade-in">

      {/* Header */}

      <div className="mb-8">

        <h1 className="text-5xl font-bold mb-3">
          Market
        </h1>

        <p className="text-zinc-300 text-lg">
          Live Indian market overview
        </p>

      </div>

      {/* Index prices */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            NIFTY 50
          </p>

          <h2 className="text-3xl font-bold text-green-400">
            {nifty ? formatPrice(nifty) : "--"}
          </h2>

        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            BANKNIFTY
          </p>

          <h2 className="text-3xl font-bold text-blue-400">
            {banknifty
              ? formatPrice(banknifty)
              : "--"}
          </h2>

        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

          <p className="text-zinc-300 mb-2">
            SENSEX
          </p>

          <h2 className="text-3xl font-bold text-yellow-400">
            {sensex ? formatPrice(sensex) : "--"}
          </h2>

        </div>

      </div>

      {/* Market status */}

      <div className="flex items-center gap-3 mb-10 px-1">

        <span
          className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold border ${
            marketStatus.isOpen
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}
        >

          <span
            className={`w-2 h-2 rounded-full ${
              marketStatus.isOpen
                ? "bg-green-400 animate-pulse"
                : "bg-red-400"
            }`}
          />

          {marketStatus.isOpen
            ? "MARKET OPEN"
            : "MARKET CLOSED"}

        </span>

        {!marketStatus.isOpen &&
          marketStatus.timeUntilOpen && (
            <span className="text-zinc-300 text-sm">
              Opens in{" "}
              {marketStatus.timeUntilOpen}
            </span>
          )}

      </div>

      {/* Expiry Calendar */}

      <div className="mb-10">

        <h2 className="text-2xl font-bold mb-5">
          Expiry Dates
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* NIFTY */}

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

            <p className="text-green-400 font-semibold mb-4">
              NIFTY (Weekly · Tue)
            </p>

            <div className="space-y-3">

              {expiries.nifty.length === 0 ? (

                <div className="text-zinc-400 text-sm">
                  Loading...
                </div>

              ) : (

                expiries.nifty.map(
                  ({ date, dte }, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center"
                    >

                      <span className="text-sm text-zinc-300">
                        {formatExpiry(date)}
                      </span>

                      <span
                        className={`text-sm font-semibold px-2 py-0.5 rounded-md ${
                          dte <= 1
                            ? "bg-red-500/20 text-red-400"
                            : dte <= 3
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {dte === 0
                          ? "Today"
                          : `${dte}d`}
                      </span>

                    </div>
                  )
                )

              )}

            </div>

          </div>

          {/* SENSEX */}

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

            <p className="text-yellow-400 font-semibold mb-4">
              SENSEX (Weekly · Thu)
            </p>

            <div className="space-y-3">

              {expiries.sensex.length === 0 ? (

                <div className="text-zinc-400 text-sm">
                  Loading...
                </div>

              ) : (

                expiries.sensex.map(
                  ({ date, dte }, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center"
                    >

                      <span className="text-sm text-zinc-300">
                        {formatExpiry(date)}
                      </span>

                      <span
                        className={`text-sm font-semibold px-2 py-0.5 rounded-md ${
                          dte <= 1
                            ? "bg-red-500/20 text-red-400"
                            : dte <= 3
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {dte === 0
                          ? "Today"
                          : `${dte}d`}
                      </span>

                    </div>
                  )
                )

              )}

            </div>

          </div>

          {/* BANKNIFTY */}

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">

            <p className="text-blue-400 font-semibold mb-4">
              BANKNIFTY (Monthly · Last Tue)
            </p>

            <div className="space-y-3">

              {expiries.banknifty.length === 0 ? (

                <div className="text-zinc-400 text-sm">
                  Loading...
                </div>

              ) : (

                expiries.banknifty.map(
                  ({ date, dte }, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center"
                    >

                      <span className="text-sm text-zinc-300">
                        {formatExpiry(date)}
                      </span>

                      <span
                        className={`text-sm font-semibold px-2 py-0.5 rounded-md ${
                          dte <= 5
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {dte === 0
                          ? "Today"
                          : `${dte}d`}
                      </span>

                    </div>
                  )
                )

              )}

            </div>

          </div>

        </div>

      </div>

      {/* Top 10 Nifty 50 Stocks */}

      <div>

        <h2 className="text-2xl font-bold mb-5">
          Nifty 50 — Top Stocks LTP
        </h2>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

          {stocksLoading ? (

            <div className="flex items-center justify-center py-16">

              <div className="w-7 h-7 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />

            </div>

          ) : stocksError ? (

            <div className="p-6 text-red-400 text-sm">
              Failed to load stock prices:{" "}
              {stocksError}
            </div>

          ) : stocks.length === 0 ? (

            <div className="p-6 text-zinc-400 text-sm">
              No stock data available
            </div>

          ) : (

            <div>

              {/* Table header */}

              <div className="grid grid-cols-3 px-6 py-3 border-b border-zinc-800 text-sm text-zinc-300 font-semibold uppercase tracking-wider">

                <span>Symbol</span>

                <span className="text-right">
                  LTP (₹)
                </span>

                <span className="text-right">
                  Change
                </span>

              </div>

              {stocks.map((stock, i) => (

                <div
                  key={stock.symbol}
                  className={`grid grid-cols-3 px-6 py-4 items-center ${
                    i < stocks.length - 1
                      ? "border-b border-zinc-800/60"
                      : ""
                  }`}
                >

                  <span className="font-semibold text-sm">
                    {stock.symbol}
                  </span>

                  <span className="text-right font-bold">
                    {formatPrice(stock.price)}
                  </span>

                  <span
                    className={`text-right font-semibold text-sm ${
                      stock.change >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {stock.change >= 0 ? "+" : ""}
                    {formatPrice(stock.change)}
                  </span>

                </div>

              ))}

            </div>

          )}

        </div>

      </div>

    </div>
  );
}
