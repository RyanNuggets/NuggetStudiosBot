// Features/Payment/utils/permissions.js

export function hasAllowedRole(member, roleId) {
  if (!roleId) return false;
  const roles = member?.roles?.cache ?? member?.roles;
  if (!roles) return false;
  return roles.has ? roles.has(roleId) : Array.isArray(roles) ? roles.includes(roleId) : false;
}
