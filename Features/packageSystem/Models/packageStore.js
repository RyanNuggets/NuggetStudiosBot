// Features/packageSystem/Models/packageStore.js
//
// Replaces the old Mongoose Package model. Data lives as JSON on the
// Railway volume mounted at DATA_DIR (see Features/Shared/jsonStore.js).
import { readCollection, mutateCollection } from "../../Shared/jsonStore.js";

const PACKAGES_FILE = "packages.json";

export async function listPackages() {
  const packages = await readCollection(PACKAGES_FILE);
  return [...packages].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function findPackage(predicate) {
  const packages = await readCollection(PACKAGES_FILE);
  return packages.find(predicate) ?? null;
}

export async function findPackageByName(name) {
  return findPackage((p) => p.name === name);
}

export async function findPackageByMessageId(messageId) {
  return findPackage((p) => p.messageId === messageId);
}

export async function findPackageByNameOrAssetId(name, assetId) {
  return findPackage((p) => p.name === name || (assetId != null && p.assetId === assetId));
}

export async function createPackage(data) {
  return mutateCollection(PACKAGES_FILE, (packages) => {
    const now = new Date().toISOString();
    const pkg = { claims: [], ...data, createdAt: now, updatedAt: now };
    packages.push(pkg);
    return pkg;
  });
}

// `name` identifies the package to update (package names are unique, same as
// the old Mongoose model's lookup key).
export async function updatePackage(name, patch) {
  return mutateCollection(PACKAGES_FILE, (packages) => {
    const pkg = packages.find((p) => p.name === name);
    if (!pkg) return null;
    Object.assign(pkg, patch, { updatedAt: new Date().toISOString() });
    return pkg;
  });
}

export async function deletePackageByName(name) {
  return mutateCollection(PACKAGES_FILE, (packages) => {
    const index = packages.findIndex((p) => p.name === name);
    if (index === -1) return null;
    const [removed] = packages.splice(index, 1);
    return removed;
  });
}
