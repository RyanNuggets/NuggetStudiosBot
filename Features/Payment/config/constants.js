// Features/Payment/config/constants.js
// Shared enums/constants used across the feature. Keeping these in one
// place avoids typo'd magic strings scattered across files.

export const PaymentStatus = {
  PENDING: "Pending", // session created, method not yet chosen
  AWAITING_VERIFICATION: "Awaiting Verification", // roblox: link generated, waiting on "I've Paid"
  AWAITING_PAYMENT: "Awaiting Payment", // ziina/paypal: link generated, waiting on confirmation
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  FAILED: "Failed",
};

export const PaymentMethod = {
  ROBUX_GAMEPASS: "Robux Gamepass",
  ROBUX_TSHIRT: "Robux T-Shirt",
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
  CARD: "Credit/Debit Card",
};

// Which methods are "Roblox" methods subject to the single-pending-payment rule.
export const ROBLOX_METHODS = [PaymentMethod.ROBUX_GAMEPASS, PaymentMethod.ROBUX_TSHIRT];

// Which methods go through Ziina vs PayPal.
export const ZIINA_METHODS = [PaymentMethod.APPLE_PAY, PaymentMethod.GOOGLE_PAY];
export const PAYPAL_METHODS = [PaymentMethod.CARD];

export const CustomId = {
  METHOD_SELECT: "pay:method", // pay:method:{paymentId}
  ROBLOX_CONFIRM: "pay:roblox:confirm", // pay:roblox:confirm:{paymentId}
  ROBLOX_REVERIFY: "pay:roblox:reverify", // pay:roblox:reverify:{paymentId}
  ROBLOX_PAID: "pay:roblox:paid", // pay:roblox:paid:{paymentId}
  CURRENCY_SELECT: "pay:currency", // pay:currency:{paymentId}
  ONLINE_PAID: "pay:online:paid", // pay:online:paid:{paymentId}
  CUSTOMER_SELECT: "pay:customer", // pay:customer:{paymentId} (used only in the fallback flow, see modals/paymentModal.js)
  FORCE_EXPIRE_SELECT: "pay:forceexpire", // pay:forceexpire (admin command)
};
