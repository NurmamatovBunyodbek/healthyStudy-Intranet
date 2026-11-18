import type { Request } from 'express';

export type IntranetAuthType = 'jwt' | 'api_key' | 'internal';

export interface IntranetActor {
  userId: string;
  fullName: string;
  phone?: string;
  avatar?: string;
  role: string;
  platformRoles: string[];
  ownedOrgIds: string[];
  orgRoles: Record<string, string[]>;
  tenantKey: string;
  organizationId?: string;
  authType: IntranetAuthType;
  isPlatformAdmin: boolean;
  isInternalService: boolean;
  rawAuthHeader?: string;
}

export interface IntranetAuthenticatedRequest extends Request {
  user: IntranetActor;
}
