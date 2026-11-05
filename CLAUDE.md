## Server source of truth
Edit server/trading-server.ts only. server/trading-server.js is a build artefact:
the Dockerfile runs `npx tsc --project server/tsconfig.json`, which regenerates it on
every Railway deploy. Edits to the .js never reach production.

## Charges
Live trade charges now include an estimated bid-ask spread cost; backtest calcCharges is Zerodha fees only.

## Secrets
Read credentials from .env.local at runtime. Never hardcode, write or print keys or tokens.
