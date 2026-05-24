import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="w-72 border-r border-zinc-800 bg-black/70 p-6 hidden lg:block min-h-screen">

      <h1 className="text-3xl font-bold mb-10 text-white">
        AI Trading Arena
      </h1>

      <div className="space-y-3">

        <Link href="/">
          <div className="w-full px-4 py-3 rounded-2xl text-zinc-400 hover:bg-zinc-900 hover:text-white transition-all cursor-pointer">
            Dashboard
          </div>
        </Link>

        <Link href="/leaderboard">
          <div className="w-full px-4 py-3 rounded-2xl text-zinc-400 hover:bg-zinc-900 hover:text-white transition-all cursor-pointer">
            Leaderboard
          </div>
        </Link>

        <Link href="/trades">
          <div className="w-full px-4 py-3 rounded-2xl text-zinc-400 hover:bg-zinc-900 hover:text-white transition-all cursor-pointer">
            Trades
          </div>
        </Link>

        <Link href="/market">
          <div className="w-full px-4 py-3 rounded-2xl text-zinc-400 hover:bg-zinc-900 hover:text-white transition-all cursor-pointer">
            Market
          </div>
        </Link>

        <div className="pt-3 pb-1">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-widest px-4">
            Crypto
          </p>
        </div>

        <Link href="/btc">
          <div className="w-full px-4 py-3 rounded-2xl text-orange-400/80 hover:bg-orange-500/10 hover:text-orange-300 transition-all cursor-pointer flex items-center gap-2">
            <span>₿</span>
            <span>BTC Arena</span>
          </div>
        </Link>

      </div>

    </aside>
  );
}