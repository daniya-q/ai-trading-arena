"use client";

import { useAIThoughtStore } from "@/store/aiThoughtStore";

export default function AIThoughts() {
  const thoughts =
    useAIThoughtStore(
      (state) =>
        state.thoughts
    );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        Live AI Thought Stream
      </h2>

      <div className="space-y-4 max-h-[700px] overflow-y-auto">

        {thoughts.map(
          (
            thought,
            index
          ) => (
            <div
              key={index}
              className="bg-black border border-zinc-800 rounded-2xl p-5"
            >

              <div className="flex items-center justify-between mb-4">

                <div className="flex items-center gap-3">

                  <h3 className="text-2xl font-bold text-white">
                    {
                      thought.bot
                    }
                  </h3>

                  <span
                    className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                      thought.action ===
                      "BUY"
                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                        : thought.action ===
                          "SELL"
                        ? "bg-red-500/10 text-red-400 border border-red-500/20"
                        : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                    }`}
                  >
                    {
                      thought.action
                    }
                  </span>

                </div>

                <div className="text-right">

                  <p className="text-zinc-300 text-sm">
                    Confidence
                  </p>

                  <h4 className="text-xl font-bold text-blue-400">
                    {
                      thought.confidence
                    }
                    %
                  </h4>

                </div>

              </div>

              <p className="text-zinc-300 text-lg leading-relaxed mb-4">
                "
                {
                  thought.thought
                }
                "
              </p>

              <div className="flex items-center justify-between text-sm text-zinc-300">

                <span>
                  Market Regime:{" "}
                  {
                    thought.marketRegime
                  }
                </span>

                <span>
                  {new Date(
                    thought.timestamp
                  ).toLocaleTimeString()}
                </span>

              </div>

            </div>
          )
        )}

      </div>

    </div>
  );
}