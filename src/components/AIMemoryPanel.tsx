"use client";

import { useAIMemoryStore } from "@/store/aiMemoryStore";

export default function AIMemoryPanel() {
  const memories =
    useAIMemoryStore(
      (state) =>
        state.memories
    );

  const entries =
    Object.entries(
      memories
    );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-10">

      <h2 className="text-3xl font-bold mb-8 text-white">
        AI Learning Memory System
      </h2>

      <div className="space-y-6">

        {entries.map(
          ([
            bot,
            memory,
          ]) => (
            <div
              key={bot}
              className="bg-black border border-zinc-800 rounded-2xl p-6"
            >

              <div className="flex items-center justify-between mb-5">

                <div>

                  <h3 className="text-3xl font-bold text-white mb-2">
                    {bot}
                  </h3>

                  <p className="text-zinc-500">
                    Adaptive Trading Intelligence
                  </p>

                </div>

                <div className="text-right">

                  <p className="text-zinc-500 text-sm mb-2">
                    Confidence Score
                  </p>

                  <h3
                    className={`text-4xl font-bold ${
                      memory.confidenceScore >=
                      70
                        ? "text-green-400"
                        : memory.confidenceScore >=
                          40
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {
                      memory.confidenceScore
                    }
                  </h3>

                </div>

              </div>

              <div className="space-y-3">

                {memory.lessons
                  .slice(0, 5)
                  .map(
                    (
                      lesson,
                      index
                    ) => (
                      <div
                        key={index}
                        className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                      >

                        <p className="text-zinc-300 leading-relaxed whitespace-pre-line">
                          {
                            lesson
                          }
                        </p>

                      </div>
                    )
                  )}

              </div>

            </div>
          )
        )}

        {entries.length ===
          0 && (
          <div className="text-center text-zinc-500 py-10">
            No AI memories yet
          </div>
        )}

      </div>

    </div>
  );
}