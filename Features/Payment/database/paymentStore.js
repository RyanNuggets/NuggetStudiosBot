// Features/Payment/database/paymentStore.js
//
// Simple JSON-file-backed store for payment sessions, in the same spirit
// as the JSON order record store used elsewhere in the bot. If you're
// running on Railway, point PAYMENT_DB_PATH at a file inside your
// persistent volume mount (e.g. /data/payments.json) so records survive
// redeploys.
//
// Every read/write goes through this module - nothing else should touch
// the JSON file directly.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PaymentStatus } from "../config/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.PAYMENT_DB_PATH || path.join(__dirname, "payments.json");

let cache = null; // in-memory mirror of the JSON file, rewritten on every mutation
let writeQueue = Promise.resolve(); // serializes writes so concurrent handlers can't clobber each other

function ensureFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ payments: {} }, null, 2));
}

function load() {
  if (cache) return cache;
  ensureFile();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  try {
    cache = JSON.parse(raw);
  } catch {
    cache = { payments: {} };
  }
  if (!cache.payments) cache.payments = {};
  return cache;
}

function persist() {
  // Queue writes so two near-simultaneous mutations don't race on the file.
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(DB_PATH, JSON.stringify(cache, null, 2), (err) => {
          if (err) reject(err);
          else resolve();
        });
      })
  );
  return writeQueue;
}

/**
 * Creates a new payment session record.
 * @param {object} data
 */
export async function createPayment(data) {
  const db = load();
  const now = Date.now();

  const record = {
    paymentId: data.paymentId,
    customerId: data.customerId,
    staffId: data.staffId,
    description: data.description || null,
    method: data.method || null, // set once chosen
    currency: data.currency || null,
    robuxAmount: data.robuxAmount,
    convertedAmount: data.convertedAmount ?? null,
    robloxUserId: data.robloxUserId ?? null,
    robloxUsername: data.robloxUsername ?? null,
    robloxAvatarUrl: data.robloxAvatarUrl ?? null,
    providerPaymentId: data.providerPaymentId ?? null,
    paymentUrl: data.paymentUrl ?? null,
    status: data.status || PaymentStatus.PENDING,
    guildId: data.guildId,
    channelId: data.channelId,
    messageId: data.messageId ?? null,
    createdAt: now,
    completedAt: null,
    expiredAt: null,
  };

  db.payments[record.paymentId] = record;
  await persist();
  return record;
}

export function getPayment(paymentId) {
  const db = load();
  return db.payments[paymentId] || null;
}

export async function updatePayment(paymentId, updates) {
  const db = load();
  const existing = db.payments[paymentId];
  if (!existing) return null;

  const updated = { ...existing, ...updates };
  db.payments[paymentId] = updated;
  await persist();
  return updated;
}

export async function markCompleted(paymentId) {
  return updatePayment(paymentId, { status: PaymentStatus.COMPLETED, completedAt: Date.now() });
}

export async function markExpired(paymentId) {
  return updatePayment(paymentId, { status: PaymentStatus.EXPIRED, expiredAt: Date.now() });
}

export async function markCancelled(paymentId) {
  return updatePayment(paymentId, { status: PaymentStatus.CANCELLED });
}

export async function markFailed(paymentId) {
  return updatePayment(paymentId, { status: PaymentStatus.FAILED });
}

/**
 * Finds an existing *active* Roblox payment (Pending / Awaiting Verification)
 * for this guild, if one exists. Used to enforce the "only one pending
 * Roblox payment at a time" rule. Ziina/PayPal payments are excluded.
 */
export function findActiveRobloxPayment(guildId) {
  const db = load();
  const active = Object.values(db.payments).find(
    (p) =>
      p.guildId === guildId &&
      (p.method === "Robux Gamepass" || p.method === "Robux T-Shirt") &&
      (p.status === PaymentStatus.PENDING || p.status === PaymentStatus.AWAITING_VERIFICATION)
  );
  return active || null;
}

export function listActivePayments(guildId) {
  const db = load();
  return Object.values(db.payments).filter(
    (p) =>
      p.guildId === guildId &&
      (p.status === PaymentStatus.PENDING ||
        p.status === PaymentStatus.AWAITING_VERIFICATION ||
        p.status === PaymentStatus.AWAITING_PAYMENT)
  );
}

export function listAllPayments(guildId) {
  const db = load();
  return Object.values(db.payments).filter((p) => p.guildId === guildId);
}
