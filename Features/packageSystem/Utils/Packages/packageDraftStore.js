// Features/packageSystem/Utils/Packages/packageDraftStore.js
const TEN_MINUTES_MS = 10 * 60 * 1000;

const drafts = new Map();

function scheduleExpiry(userId, entry) {
  const timeout = setTimeout(() => {
    drafts.delete(userId);
  }, TEN_MINUTES_MS);

  if (typeof timeout.unref === "function") {
    timeout.unref();
  }

  entry.timeout = timeout;
}

export function saveDraft(userId, draft) {
  if (!userId) {
    throw new TypeError("userId is required to save a draft.");
  }
  if (!draft) {
    throw new TypeError("draft payload is required.");
  }

  const now = Date.now();
  const existing = drafts.get(userId);
  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }

  const entry = {
    draft,
    createdAt: now,
    expiresAt: now + TEN_MINUTES_MS,
    timeout: null,
  };

  scheduleExpiry(userId, entry);
  drafts.set(userId, entry);

  return { createdAt: entry.createdAt, expiresAt: entry.expiresAt };
}

export function fetchDraft(userId) {
  const entry = drafts.get(userId);
  if (!entry) {
    return { draft: null, expired: false };
  }

  if (Date.now() >= entry.expiresAt) {
    if (entry.timeout) {
      clearTimeout(entry.timeout);
    }
    drafts.delete(userId);
    return { draft: null, expired: true };
  }

  return {
    draft: entry.draft,
    expired: false,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
}

export function deleteDraft(userId) {
  const entry = drafts.get(userId);
  if (!entry) return false;

  if (entry.timeout) {
    clearTimeout(entry.timeout);
  }

  return drafts.delete(userId);
}

export { TEN_MINUTES_MS };
