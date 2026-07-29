# Payment Feature

Drop-in payment module for a Discord.js v14 bot supporting Robux (Gamepass/T-Shirt),
Apple Pay / Google Pay (via Ziina), and Credit/Debit Card (via PayPal).

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
    "robloxCookieEnvVar": "ROBLOX_COOKIE",
    "robuxToAed": { "robux": 1000, "aed": 37 },
    "ziina": { "apiKey": "YOUR_ZIINA_API_KEY", "testMode": true },
    "paypal": { "clientId": "...", "clientSecret": "...", "mode": "sandbox" },
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

- `ROBLOX_COOKIE` - the `.ROBLOSECURITY` cookie for the account that owns the gamepass/t-shirt.
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
   transaction history to confirm the Robux actually arrived.
4. **Apple Pay / Google Pay:** asks for currency, creates a Ziina payment intent,
   and polls its status once "I've Paid" is clicked.
5. **Credit/Debit Card:** same, via a PayPal order (create → approve → capture).
6. Every payment gets a **Payment Complete** embed and is logged to your
   configured log channel(s) at every step (created, method chosen, link
   generated, completed, expired, errors, etc).
7. Only one Robux Gamepass/T-Shirt payment can be pending at a time per server -
   trying to start a second one shows a jump link to the existing one. Staff can
   force-expire it with `/forceexpirepayment`. This restriction does not apply to
   Ziina/PayPal payments.
8. A background sweep expires any payment that's sat unpaid past
   `paymentExpiryMinutes` (default 30).

## 5. Things worth double-checking before going live

- **Roblox endpoints** (`providers/robloxProvider.js`): the gamepass price-update
  and transaction-verification calls hit Roblox's REST APIs directly. These
  occasionally change shape - if you hit unexpected errors, check your installed
  `noblox.js` version for a built-in helper first (it gets updated for exactly
  this reason) before assuming the raw call is wrong.
- **Ziina / PayPal field names**: double-check `providers/ziinaProvider.js` and
  `providers/paypalProvider.js` against the current docs
  (https://docs.ziina.com and https://developer.paypal.com/docs/api/orders/v2/)
  before processing real payments - request/response shapes can shift between
  doc revisions.
- **PayPal + AED**: PayPal checkout doesn't support AED as of writing. If a
  customer picks Card and AED, either route through Ziina instead or convert to
  USD before creating the PayPal order.
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
    ziinaProvider.js            - Apple Pay / Google Pay
    paypalProvider.js           - Credit/Debit Card
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
    onlinePaymentHandler.js     - currency select, Ziina/PayPal generation + paid button
    expirySweep.js              - background job expiring stale payments
```
