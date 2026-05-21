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

      </div>

    </aside>
  );
}