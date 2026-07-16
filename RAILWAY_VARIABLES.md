# Railway setup

This bot no longer reads a `.env` file and no longer uses MongoDB. Everything
comes from **Railway's Variables tab** on the service, and all persistent
data (orders, payouts, packages, package download files) is stored as JSON
on a **Railway Volume**.

## 1. Attach a Volume

1. On the service, go to **Settings → Volumes → Add Volume**.
2. Mount path: `/data` (any path works, just make it match `DATA_DIR` below).

## 2. Service Variables

Set these under **Variables** on the Railway service (not in a `.env` file —
Railway injects them directly into `process.env` at runtime):

| Variable | Required | Notes |
|---|---|---|
| `TOKEN` | ✅ | Discord bot token used to log in. |
| `CLIENT_ID` | ✅ | Discord application (client) ID, needed to register slash commands. |
| `BLOXLINK_API_KEY` | ✅ | Server API Key from https://blox.link/dashboard (your server → Developers). Your server must have the Bloxlink bot added. Roblox <-> Discord account linking. |
| `DATA_DIR` | recommended | Path to the mounted volume, e.g. `/data`. `packages.json` and package downloads are stored here. **Without this set, data is written to `./data` in the container and is lost on every redeploy.** |
| `PACKAGE_FILES_DIR` | optional | Overrides where package download files are cached, if you want them somewhere other than `<DATA_DIR>/packages/downloads`. |

## What changed

- **Order logging system removed**: the `/order` command, payout tracking, and Roblox group-payment cross-verification have been deleted entirely (`Features/orderLogging/`), along with their config block and the `noblox.js`/`uuid` dependencies they needed. `DISCORD_TOKEN` and `ROBLOX_COOKIE` are no longer used anywhere.
- **MongoDB → Railway Volume**: the package system used to store Packages in MongoDB (`MONGODB_URI`). It now stores the same data as a plain JSON file (`packages.json`) under `DATA_DIR`. `MONGODB_URI` is no longer used or required.
- **`.env` file → Railway Variables**: the bot already read everything from `process.env`, so there's no code change needed on your end besides moving the values from your old `.env` into the Railway dashboard's Variables tab. The `dotenv` package has been removed since it was never actually loaded (nothing imported `dotenv/config`).
