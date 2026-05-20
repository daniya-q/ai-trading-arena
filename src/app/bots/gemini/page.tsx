export default function Page() {
  return (
    <div className="min-h-screen bg-black text-white p-10">

      <h1 className="text-5xl font-bold mb-6">
        Gemini Trading Agent
      </h1>

      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">

        <p className="text-zinc-400 text-lg mb-4">
          Initial Capital
        </p>

        <h2 className="text-4xl font-bold mb-8">
          ₹1,00,000
        </h2>

        <div className="grid grid-cols-2 gap-6">

          <div className="bg-black border border-zinc-800 rounded-2xl p-6">
            <p className="text-zinc-500 mb-2">
              Current P&L
            </p>

            <h3 className="text-3xl font-bold text-green-400">
              +₹34,920
            </h3>
          </div>

          <div className="bg-black border border-zinc-800 rounded-2xl p-6">
            <p className="text-zinc-500 mb-2">
              Win Rate
            </p>

            <h3 className="text-3xl font-bold">
              58%
            </h3>
          </div>

        </div>

      </div>

    </div>
  );
}