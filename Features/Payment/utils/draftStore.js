// Features/Payment/utils/draftStore.js
//
// Bridges the gap between "modal submitted" (we know robuxAmount +
// description) and "customer selected" (we know who it's for) - see
// modals/paymentModal.js for context. This is intentionally in-memory
// only: drafts are only relevant for the ~2 minutes between those two
// interactions, and losing one on a bot restart just means the staff
// member re-runs /payment - no need to persist it.

import crypto from "crypto";

const drafts = new Map();
const DRAFT_TTL_MS = 5 * 60 * 1000;

export function createDraft(data) {
  const draftId = crypto.randomBytes(4).toString("hex");
  drafts.set(draftId, { ...data, createdAt: Date.now() });

  setTimeout(() => drafts.delete(draftId), DRAFT_TTL_MS).unref?.();

  return draftId;
}

export function getDraft(draftId) {
  const draft = drafts.get(draftId);
  if (!draft) return null;
  if (Date.now() - draft.createdAt > DRAFT_TTL_MS) {
    drafts.delete(draftId);
    return null;
  }
  return draft;
}

export function deleteDraft(draftId) {
  drafts.delete(draftId);
}
