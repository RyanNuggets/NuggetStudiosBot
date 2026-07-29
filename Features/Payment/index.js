// Features/Payment/index.js
//
// Drop this whole `Payment/` folder into `Features/` in your existing bot,
// then in your main bot file:
//
//   import registerPaymentModule from "./Features/Payment/index.js";
//   registerPaymentModule(client);
//
// That's it. It registers /payment + /forceexpirepayment, and attaches its
// own scoped interactionCreate listener (only reacts to "pay:*" customIds
// and its own two commands). The "Reverify Account" button just re-reads
// the customer's current Bloxlink link and refreshes the confirm embed -
// no separate verification feature required.
//
// See README.md for full setup (config.json keys, env vars, dependencies).

import { paymentCommandData } from "./commands/payment.js";
import { forceExpirePaymentCommandData } from "./commands/forceexpirepayment.js";
import { registerPaymentCommands } from "./utils/registerCommands.js";
import { setupPaymentInteractionRouter } from "./handlers/interactionRouter.js";
import { startExpirySweep } from "./handlers/expirySweep.js";

export default function registerPaymentModule(client) {
  client.once("ready", async () => {
    try {
      await registerPaymentCommands(client, [paymentCommandData, forceExpirePaymentCommandData]);
      startExpirySweep(client);
      console.log("✅ Payment module registered");
    } catch (err) {
      console.error("❌ [PAYMENT] register error:", err);
    }
  });

  setupPaymentInteractionRouter(client);
}
