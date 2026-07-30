// Features/Payment/config/constants.js
// Shared enums/constants used across the feature. Keeping these in one
// place avoids typo'd magic strings scattered across files.

export const PaymentStatus = {
  PENDING: "Pending", // session created, method not yet chosen
  AWAITING_VERIFICATION: "Awaiting Verification", // roblox: link generated, waiting on "I've Paid"
  AWAITING_PAYMENT: "Awaiting Payment", // online: link generated, waiting on confirmation
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  FAILED: "Failed",
};

export const PaymentMethod = {
  ROBUX_GAMEPASS: "Robux Gamepass",
  ROBUX_TSHIRT: "Robux T-Shirt",
  // Single grouped option covering Apple Pay, Google Pay, and Credit/Debit
  // Card - all three are offered on the same hosted checkout page, so the
  // customer doesn't need to pick between them up front.
  ONLINE_PAYMENT: "Card / Apple Pay / Google Pay",
};

// Which methods are "Roblox" methods subject to the single-pending-payment rule.
export const ROBLOX_METHODS = [PaymentMethod.ROBUX_GAMEPASS, PaymentMethod.ROBUX_TSHIRT];

// Which methods go through the online payment provider (currency select -> checkout link -> "I've Paid").
export const ONLINE_METHODS = [PaymentMethod.ONLINE_PAYMENT];

export const CustomId = {
  METHOD_SELECT: "pay:method", // pay:method:{paymentId} - only shown for the Robux path (Gamepass/T-Shirt)
  ROBLOX_CONFIRM: "pay:roblox:confirm", // pay:roblox:confirm:{paymentId}
  ROBLOX_REVERIFY: "pay:roblox:reverify", // pay:roblox:reverify:{paymentId}
  ROBLOX_PAID: "pay:roblox:paid", // pay:roblox:paid:{paymentId}
  ONLINE_PAID: "pay:online:paid", // pay:online:paid:{paymentId}
  CUSTOMER_SELECT: "pay:customer", // pay:customer:{draftId}

  // Currency/Robux choice step - shown right after a customer is picked,
  // before any payment-method-specific screen. See handlers/paymentChoiceHandler.js.
  CHOICE_SELECT: "pay:choice:select", // pay:choice:select:{paymentId}
  CHOICE_CONFIRM: "pay:choice:confirm", // pay:choice:confirm:{paymentId}:{value}  (value = "ROBUX" or a currency code)
  CHOICE_BACK: "pay:choice:back", // pay:choice:back:{paymentId}

  // /payment diagnose - see commands/paymentDiagnose.js
  DIAGNOSE_SELECT: "pay:diagnose:select", // pay:diagnose:select:{paymentId}
  DIAGNOSE_REFRESH: "pay:diagnose:refresh", // pay:diagnose:refresh:{paymentId}
  DIAGNOSE_BACK: "pay:diagnose:back", // pay:diagnose:back
  DIAGNOSE_FORCEEXPIRE_ASK: "pay:diagnose:forceexpire:ask", // pay:diagnose:forceexpire:ask:{paymentId}
  DIAGNOSE_FORCEEXPIRE_CONFIRM: "pay:diagnose:forceexpire:confirm", // pay:diagnose:forceexpire:confirm:{paymentId}
  DIAGNOSE_FORCEEXPIRE_CANCEL: "pay:diagnose:forceexpire:cancel", // pay:diagnose:forceexpire:cancel:{paymentId}
};
