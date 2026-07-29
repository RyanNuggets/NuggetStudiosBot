// Features/Payment/config/config.js
//
// Every file in this feature reads config through this module instead of
// touching the root config.json directly - keeps this feature portable and
// makes it obvious what settings it depends on.
//
// Expected shape in your bot's root config.json:
//
// {
//   "payment": {
//     "allowedRoleId": "123456789012345678",
//     "bloxlinkApiKey": "...",
//     "gamepassId": 000000000,
//     "tshirtId": 000000000,
//     "robloxCookieEnvVar": "ROBLOX_COOKIE",
//     "robuxToAed": { "robux": 1000, "aed": 37 },
//     "ziina": {
//       "apiKey": "...",
//       "testMode": true
//     },
//     "paypal": {
//       "clientId": "...",
//       "clientSecret": "...",
//       "mode": "sandbox"
//     },
//     "exchangeRates": {
//       "provider": "https://open.er-api.com/v6/latest/AED",
//       "cacheMinutes": 30
//     },
//     "logChannels": {
//       "default": "123456789012345678",
//       "payments": "123456789012345678",
//       "errors": "123456789012345678"
//     },
//     "embedColors": {
//       "default": "#5865F2",
//       "success": "#57F287",
//       "warning": "#FEE75C",
//       "danger": "#ED4245"
//     },
//     "paymentExpiryMinutes": 30
//   }
// }

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root config.json lives at the top of the bot, two levels up from
// Features/Payment/config/.
const ROOT_CONFIG_PATH = path.join(__dirname, "..", "..", "..", "config.json");

function readRootConfig() {
  const raw = fs.readFileSync(ROOT_CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function getConfig() {
  const root = readRootConfig();
  const payment = root.payment || {};

  return {
    // Discord
    allowedRoleId: payment.allowedRoleId ?? null,
    logChannels: {
      default: payment.logChannels?.default ?? null,
      payments: payment.logChannels?.payments ?? payment.logChannels?.default ?? null,
      errors: payment.logChannels?.errors ?? payment.logChannels?.default ?? null,
    },
    embedColors: {
      default: payment.embedColors?.default ?? "#5865F2",
      success: payment.embedColors?.success ?? "#57F287",
      warning: payment.embedColors?.warning ?? "#FEE75C",
      danger: payment.embedColors?.danger ?? "#ED4245",
    },

    // Roblox / Bloxlink
    bloxlinkApiKey: payment.bloxlinkApiKey ?? null,
    guildId: root.guildId ?? payment.guildId ?? null,
    gamepassId: payment.gamepassId ?? null,
    tshirtId: payment.tshirtId ?? null,
    robloxCookieEnvVar: payment.robloxCookieEnvVar ?? "ROBLOX_COOKIE",

    // Pricing
    robuxToAed: {
      robux: payment.robuxToAed?.robux ?? 1000,
      aed: payment.robuxToAed?.aed ?? 37,
    },

    // Providers
    ziina: {
      apiKey: payment.ziina?.apiKey ?? null,
      testMode: payment.ziina?.testMode ?? true,
      baseUrl: payment.ziina?.baseUrl ?? "https://api-v2.ziina.com/api",
    },
    paypal: {
      clientId: payment.paypal?.clientId ?? null,
      clientSecret: payment.paypal?.clientSecret ?? null,
      mode: payment.paypal?.mode ?? "sandbox", // "sandbox" | "live"
    },
    exchangeRates: {
      provider: payment.exchangeRates?.provider ?? "https://open.er-api.com/v6/latest/AED",
      cacheMinutes: payment.exchangeRates?.cacheMinutes ?? 30,
    },

    // Behaviour
    paymentExpiryMinutes: payment.paymentExpiryMinutes ?? 30,
    supportedCurrencies: ["AED", "USD", "EUR", "GBP"],
  };
}

export default getConfig;
