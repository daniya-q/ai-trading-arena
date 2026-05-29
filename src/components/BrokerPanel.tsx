"use client";

import { useBrokerStore } from "@/store/brokerStore";

import ConnectBrokerButton from "./ConnectBrokerButton";

export default function BrokerPanel() {

  const {
    paperTrading,
    setPaperTrading,
    brokerConnected,
  } =
    useBrokerStore();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">

        <div>

          <h2 className="text-3xl font-bold text-white mb-2">
            Broker Infrastructure
          </h2>

          <p className="text-zinc-300">
            Real brokerage AI execution system
          </p>

        </div>

        <div className="flex items-center gap-4 flex-wrap">

          <div
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${
              brokerConnected
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-red-500/20 text-red-400 border border-red-500/30"
            }`}
          >

            {brokerConnected
              ? "BROKER CONNECTED"
              : "NOT CONNECTED"}

          </div>

          <button
            onClick={() =>
              setPaperTrading(
                !paperTrading
              )
            }
            className={`px-6 py-3 rounded-2xl font-semibold ${
              paperTrading
                ? "bg-green-600 hover:bg-green-500"
                : "bg-red-600 hover:bg-red-500"
            }`}
          >

            {paperTrading
              ? "PAPER MODE"
              : "LIVE MODE"}

          </button>

          <ConnectBrokerButton />

        </div>

      </div>

    </div>
  );
}