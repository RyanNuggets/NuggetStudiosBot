# Payment Feature

Drop-in payment module for a Discord.js v14 bot supporting Robux (Gamepass/T-Shirt)
and a grouped Card / Apple Pay / Google Pay option (via Ziina).

## 1. Install

Copy the whole `Payment/` folder into your bot's `Features/` directory:

```
Features/
  Payment/        <- this folder
```

Install the one extra dependency this feature needs (discord.js, discord-api-types,
and Node 18+'s built-in `fetch` are assumed to already be present, same as your
existing payment.js):

```bash
npm install noblox.js
```

## 2. Wire it up

In your main bot file, after your client logs in / is constructed:

```js
import registerPaymentModule from "./Features/Payment/index.js";

registerPaymentModule(client);
```

That's it - it registers `/payment` and `/forceexpirepayment`, and attaches its own
scoped `interactionCreate` listener (only reacts to `pay:*` customIds and its own
two commands, so it won't interfere with anything else your bot handles). The
"Reverify Account" button re-reads the customer's current Bloxlink link and
refreshes the confirm embed directly - it doesn't depend on any other feature.

## 3. Configure

Add a `payment` block to your bot's root `config.json` (see
`config/config.js` for the full annotated shape and every default):

```jsonc
{
  "payment": {
    "allowedRoleId": "STAFF_ROLE_ID",
    "bloxlinkApiKey": "YOUR_BLOXLINK_V4_API_KEY",
    "gamepassId": 000000000,
    "tshirtId": 000000000,
    "universeId": 000000000,
    "groupId": 000000000,
    "robloxCookieEnvVar": "ROBLOX_COOKIE",
    "robloxApiKeyEnvVar": "ROBLOX_OPEN_CLOUD_KEY",
    "robuxToAed": { "robux": 1000, "aed": 37 },
    "ziina": { "apiKey": "YOUR_ZIINA_API_KEY", "testMode": true },
    "exchangeRates": { "provider": "https://open.er-api.com/v6/latest/AED", "cacheMinutes": 30 },
    "logChannels": {
      "default": "CHANNEL_ID",
      "payments": "CHANNEL_ID",
      "errors": "CHANNEL_ID"
    },
    "embedColors": {
      "default": "#5865F2",
      "success": "#57F287",
      "warning": "#FEE75C",
      "danger": "#ED4245"
    },
    "paymentExpiryMinutes": 30
  }
}
```

Environment variables (e.g. Railway variables):

- `ROBLOX_COOKIE` - the `.ROBLOSECURITY` cookie for the account that owns the gamepass/t-shirt. Still used for t-shirt pricing and for the transaction-verification ("I've Paid") check.
- `ROBLOX_OPEN_CLOUD_KEY` - an Open Cloud API key created in the Creator Hub for the experience that owns the gamepass, scoped to that universe, with Game Passes read & write access. Used only for the gamepass price update, since Roblox moved that endpoint off the cookie-based flow (see `providers/robloxProvider.js`).
- `PAYMENT_DB_PATH` - optional; point this at a file inside your Railway volume
  (e.g. `/data/payments.json`) so payment records survive redeploys. Defaults to
  `database/payments.json` next to this feature if unset.

## 4. How the flow works

1. Staff runs `/payment`, fills in **Robux Amount** + optional **Description** in a
   modal, then picks the **Customer** from a follow-up select menu (see the note in
   `modals/paymentModal.js` on why Customer isn't in the modal itself - Discord
   modals only support text inputs on the widely-deployed API version).
2. A public message is posted showing every payment method with live prices
   (Robux amount for Gamepass/T-Shirt, converted AED for the rest).
3. **Robux Gamepass / T-Shirt:** confirms the customer's linked Roblox account
   (via Bloxlink), lets them re-verify if it's wrong, updates the configured
   item's price, and gives them the purchase link. "I've Paid" checks Roblox's
   transaction history to confirm the Robux actually arrived (checked against
   the owning Group's transactions via `groupId`, since the items are
   group-owned - not the bot's personal account). Gamepass price
   updates go through Roblox's Open Cloud Game Passes API (`ROBLOX_OPEN_CLOUD_KEY`
   + `universeId`); t-shirt price updates still go through noblox.js/`ROBLOX_COOKIE`.
4. **Card / Apple Pay / Google Pay:** asks for currency, creates a Ziina payment
   intent, and polls its status once "I've Paid" is clicked. All three funding
   options are presented on the same Ziina checkout page, so they're grouped
   into one method in the bot rather than three separate choices.
5. Every payment gets a **Payment Complete** embed and is logged to your
   configured log channel(s) at every step (created, method chosen, link
   generated, completed, expired, errors, etc).
6. Only one Robux Gamepass/T-Shirt payment can be pending at a time per server -
   trying to start a second one shows a jump link to the existing one. Staff can
   force-expire it with `/forceexpirepayment`. This restriction does not apply to
   the Card/Apple Pay/Google Pay method.
7. A background sweep expires any payment that's sat unpaid past
   `paymentExpiryMinutes` (default 30).

## 5. Things worth double-checking before going live

- **Roblox endpoints** (`providers/robloxProvider.js`): the gamepass price-update
  call uses Roblox's Open Cloud Game Passes API (`x-api-key` + `universeId`) -
  Roblox deprecated the old cookie-based path for this endpoint, which is why
  older cookie/CSRF-based approaches now 404. The t-shirt price update and the
  transaction-verification call still use noblox.js/the cookie and can change
  shape on Roblox's end - if you hit unexpected errors there, check your
  installed `noblox.js` version for a built-in helper first before assuming
  the raw call is wrong.
- **Ziina field names**: double-check `providers/ziinaProvider.js` against the
  current docs (https://docs.ziina.com) before processing real payments -
  request/response shapes can shift between doc revisions.
- Swap `noblox.js`'s cookie login for whatever session-refresh approach you
  already use elsewhere in the bot, if different.

## 6. Folder structure

```
Payment/
  index.js                      - entry point, call this from your bot
  README.md
  config/
    config.js                   - reads Payment settings from root config.json
    constants.js                - status/method enums, customId prefixes
  database/
    paymentStore.js             - JSON-file-backed payment session store
    payments.json                (created automatically)
  providers/
    bloxlinkProvider.js         - Discord -> Roblox account lookup
    robloxProvider.js           - profile/avatar, pricing, purchase links, payment verification
    exchangeRateProvider.js     - live AED-based exchange rates (cached)
    ziinaProvider.js            - Card / Apple Pay / Google Pay (grouped checkout)
  utils/
    pricing.js                  - Robux <-> currency math
    logger.js                   - logs events to configured channels
    permissions.js
    ids.js
    draftStore.js               - short-lived in-memory bridge for the modal -> customer-select step
    registerCommands.js
  embeds/
    paymentMethodEmbed.js
    robloxConfirmEmbed.js
    paymentGeneratedEmbed.js
    paymentCompleteEmbed.js
    statusEmbeds.js             - errors/warnings/pending-payment/not-detected
  buttons/
    paymentMethodComponents.js
    robloxConfirmButtons.js
    ivePaidButton.js
    currencySelectMenu.js
    customerSelectMenu.js
  modals/
    paymentModal.js
  commands/
    payment.js
    forceexpirepayment.js
  handlers/
    interactionRouter.js        - single interactionCreate listener for this feature
    createPaymentHandler.js     - modal submit + customer select
    paymentMethodHandler.js     - method chosen -> branch into Roblox/online flow
    robloxPaymentHandler.js     - confirm/reverify/paid buttons
    onlinePaymentHandler.js     - currency select, Ziina generation + paid button
    expirySweep.js              - background job expiring stale payments
```
