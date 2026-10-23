/**
 * Authorization vocabulary (docs/security/SECURITY.md §3). Endpoints declare permissions,
 * never roles; roles map to permissions here so roles can later be split without touching
 * endpoints (OPEN_DECISIONS IDN-4).
 */

export const ROLES = ['passenger', 'driver', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'ride:request',
  'driver:self',
  'driver:operate',
  'driver:review',
  'vehicle:review',
  'driver:suspend',
  'driver_document:view',
  'policy:manage',
  'ride:admin',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  passenger: ['ride:request'],
  driver: ['driver:self', 'driver:operate'],
  admin: [
    'driver:review',
    'vehicle:review',
    'driver:suspend',
    'driver_document:view',
    'policy:manage',
    'ride:admin',
    'audit:read',
  ],
};

export function permissionsFor(roles: readonly Role[]): ReadonlySet<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
