// Features/packageSystem/Utils/Packages/packageFileStore.js
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "../../../Shared/jsonStore.js";

// Point this at a Railway volume mount so files survive redeploys. Defaults
// to a `packages/downloads` subfolder of DATA_DIR (see Features/Shared/jsonStore.js),
// so it lives on the same volume as orders.json/payouts.json/packages.json.
// Override with PACKAGE_FILES_DIR if you want the files stored elsewhere.
const PACKAGE_DOWNLOAD_DIR =
  process.env.PACKAGE_FILES_DIR || path.join(DATA_DIR, "packages", "downloads");
const EXTENSION_BY_CONTENT_TYPE = {
  "application/zip": ".zip",
  "application/x-rar-compressed": ".rar",
  "application/vnd.rar": ".rar",
  "application/x-7z-compressed": ".7z",
  "application/pdf": ".pdf",
};

function normalizeRelativePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sanitizeSegment(value, fallback = "package") {
  const clean = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return clean || fallback;
}

function pickExtension({ originalName, contentType }) {
  const extFromName = path.extname(String(originalName || "")).toLowerCase();
  if (extFromName && extFromName.length <= 10) {
    return extFromName;
  }

  const normalizedContentType = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  return EXTENSION_BY_CONTENT_TYPE[normalizedContentType] || "";
}

function toAbsolutePath(filePath) {
  if (!filePath) return null;
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), filePath);
}

function buildStoredName({ packageName, originalName, contentType }) {
  const safePackageName = sanitizeSegment(packageName);
  const extension = pickExtension({ originalName, contentType });
  const random = crypto.randomBytes(4).toString("hex");
  return `${safePackageName}-${Date.now()}-${random}${extension}`;
}

async function ensureDownloadDirectory() {
  const absoluteDirectory = toAbsolutePath(PACKAGE_DOWNLOAD_DIR);
  await fs.mkdir(absoluteDirectory, { recursive: true });
  return absoluteDirectory;
}

async function storePackageFile({ packageName, sourceUrl, originalName }) {
  if (!sourceUrl) {
    throw new Error("Cannot store package file without a source URL.");
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download package file. HTTP ${response.status} ${response.statusText}`
    );
  }

  const bytes = await response.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (!buffer.length) {
    throw new Error("Downloaded package file is empty.");
  }

  const contentType = response.headers.get("content-type") || "";
  const storedName = buildStoredName({ packageName, originalName, contentType });

  const absoluteDirectory = await ensureDownloadDirectory();
  const absolutePath = path.join(absoluteDirectory, storedName);
  const localPath = normalizeRelativePath(path.join(PACKAGE_DOWNLOAD_DIR, storedName));

  await fs.writeFile(absolutePath, buffer);

  return {
    localPath,
    storedName,
    name: originalName || storedName,
    size: buffer.length,
    mimeType: contentType || null,
  };
}

async function storedPackageFileExists(localPath) {
  const absolutePath = toAbsolutePath(localPath);
  if (!absolutePath) return false;

  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function deleteStoredPackageFile(localPath) {
  const absolutePath = toAbsolutePath(localPath);
  if (!absolutePath) return;

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

export {
  PACKAGE_DOWNLOAD_DIR,
  storePackageFile,
  storedPackageFileExists,
  deleteStoredPackageFile,
  toAbsolutePath,
};
