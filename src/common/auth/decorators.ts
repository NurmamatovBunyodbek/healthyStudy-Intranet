import { SetMetadata } from '@nestjs/common';

export const ROLES_METADATA_KEY = 'intranet_roles';
export const OPTIONAL_AUTH_METADATA_KEY = 'intranet_optional_auth';

/**
 * Restricts a route to tenant admins, platform admins, or authorized service callers.
 */
export const IntranetRoles = (...roles: string[]) =>
  SetMetadata(ROLES_METADATA_KEY, roles);

/**
 * Allows unauthenticated requests while still populating `req.user` when credentials exist.
 */
export const OptionalIntranetAuth = () =>
  SetMetadata(OPTIONAL_AUTH_METADATA_KEY, true);
