// Features/Shared/jsonStore.js
//
// Tiny JSON-file "database" used instead of MongoDB. Every collection is a
// single JSON file (an array of plain objects) living under `DATA_DIR`.
//
// On Railway: create a Volume, mount it at e.g. `/data`, and set the
// `DATA_DIR` service variable to that mount path (e.g. `/data`). That's it -
// no external database service needed, and the files survive redeploys.
//
// Locally (no DATA_DIR set) it falls back to `./data` in the project folder.
import fs from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

// Serializes every read/write against a given file so two interactions
// firing at the same time can't race each other and clobber a write.
const fileLocks = new Map();

function withFileLock(filePath, task) {
  const previous = fileLocks.get(filePath) ?? Promise.resolve();
  const next = previous.then(task, task);
  fileLocks.set(
    filePath,
    next.catch(() => {})
  );
  return next;
}

function resolvePath(fileName) {
  return path.join(DATA_DIR, fileName);
}

async function readJsonFile(filePath, defaultValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) return structuredClone(defaultValue);
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return structuredClone(defaultValue);
    console.error(`❌ [jsonStore] Failed to read ${filePath}, using default value:`, err);
    return structuredClone(defaultValue);
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated/corrupt file.
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
  await fs.rename(tmpPath, filePath);
}

/**
 * Read an entire collection (array) from disk.
 */
export async function readCollection(fileName, defaultValue = []) {
  const filePath = resolvePath(fileName);
  return withFileLock(filePath, () => readJsonFile(filePath, defaultValue));
}

/**
 * Read a collection, run `mutator` against it (which may mutate it in place
 * and/or return a value), persist the result, and return whatever `mutator`
 * returned. Reads and writes both happen inside the same file lock so this
 * is safe to call concurrently.
 */
export async function mutateCollection(fileName, mutator, defaultValue = []) {
  const filePath = resolvePath(fileName);
  return withFileLock(filePath, async () => {
    const data = await readJsonFile(filePath, defaultValue);
    const result = await mutator(data);
    await writeJsonFile(filePath, data);
    return result;
  });
}
