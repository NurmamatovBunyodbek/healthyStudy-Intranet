import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntranetActor } from '../auth/auth.types';
import { isActorAdminForOrg } from '../auth/intranet-auth.guard';

interface CachedEntry<T> {
  value: T;
  expiresAt: number;
}

const FEATURE_CACHE_TTL_MS = 2 * 60 * 1000;
const ROLE_CACHE_TTL_MS = 60 * 1000;
const ORG_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const STAFF_ADMIN_ROLES = new Set([
  'superadmin',
  'owner',
  'admin',
  'director',
  'manager',
]);

/**
 * Normalizes staff role keys from either legacy flat arrays/objects or
 * HealthyStudy Main Backend's `{ branches: [{ roles: [{ roleKey }] }] }` payload.
 */
export function extractRoleKeysFromStaffRolesResponse(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data.map((r) => String(r || '').trim()).filter(Boolean);
  }
  if (!data || typeof data !== 'object') {
    return [];
  }

  const obj = data as {
    roleKeys?: unknown;
    roles?: unknown;
    branches?: unknown;
  };

  const collected: string[] = [];
  const collectRoleEntry = (entry: unknown) => {
    if (typeof entry === 'string') {
      const clean = entry.trim();
      if (clean) collected.push(clean);
      return;
    }
    if (entry && typeof entry === 'object') {
      const rec = entry as {
        roleKey?: unknown;
        key?: unknown;
        role?: { key?: unknown };
      };
      const raw = rec.roleKey ?? rec.key ?? rec.role?.key;
      const clean = String(raw || '').trim();
      if (clean) collected.push(clean);
    }
  };

  if (Array.isArray(obj.roleKeys)) {
    obj.roleKeys.forEach(collectRoleEntry);
  }
  if (Array.isArray(obj.roles)) {
    obj.roles.forEach(collectRoleEntry);
  }
  if (Array.isArray(obj.branches)) {
    for (const branch of obj.branches) {
      if (branch && typeof branch === 'object') {
        const branchRoles = (branch as { roles?: unknown }).roles;
        if (Array.isArray(branchRoles)) {
          branchRoles.forEach(collectRoleEntry);
        }
      }
    }
  }

  return collected;
}

export interface OrgSummarySnapshot {
  id: string;
  name?: string;
  username?: string;
}

@Injectable()
export class MainBackendService {
  private readonly logger = new Logger(MainBackendService.name);
  private readonly featureCache = new Map<string, CachedEntry<boolean>>();
  private readonly adminRoleCache = new Map<string, CachedEntry<boolean>>();
  private readonly orgCache = new Map<string, CachedEntry<OrgSummarySnapshot | null>>();

  constructor(private readonly configService: ConfigService) {}

  private setBoundedCache<T>(
    cache: Map<string, CachedEntry<T>>,
    key: string,
    value: T,
    ttlMs: number,
  ): void {
    const now = Date.now();
    if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
      for (const [k, entry] of cache.entries()) {
        if (entry.expiresAt <= now) {
          cache.delete(k);
        }
      }
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
    }
    cache.set(key, { value, expiresAt: now + ttlMs });
  }

  private get baseUrl(): string {
    return (
      this.configService.get<string>('mainBackendUrl') || 'http://localhost:3000'
    );
  }

  private get internalSecret(): string {
    return this.configService.get<string>('internalServiceSecret') || '';
  }

  /**
   * Checks whether `intranet_lost_found` is enabled for a HealthyStudy organization.
   * External multi-tenant API key callers bypass HealthyStudy feature-flag checks.
   */
  async assertLostFoundEnabled(
    actor: IntranetActor,
    organizationId: string,
  ): Promise<void> {
    if (actor.tenantKey !== 'healthystudy' || !organizationId) {
      return;
    }

    const enabled = await this.isLostFoundFeatureEnabled(
      organizationId,
      actor.rawAuthHeader,
    );
    if (!enabled) {
      throw new ForbiddenException(
        'Lost & Found moduli ushbu markaz uchun o‘chirilgan. Permissions → Markaz modullari bo‘limidan yoqing.',
      );
    }
  }

  async isLostFoundFeatureEnabled(
    organizationId: string,
    bearerHeader?: string,
  ): Promise<boolean> {
    const now = Date.now();
    const cached = this.featureCache.get(organizationId);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.internalSecret) {
        headers['x-internal-secret'] = this.internalSecret;
      }
      if (bearerHeader) {
        headers.Authorization = bearerHeader;
      }

      const res = await fetch(
        `${this.baseUrl}/organization/${encodeURIComponent(organizationId)}/system-features`,
        { headers, signal: AbortSignal.timeout(3000) },
      );

      if (!res.ok) {
        return true;
      }

      const json = (await res.json()) as {
        features?: Record<string, unknown>;
      };
      const rawFlag = json?.features?.intranet_lost_found;
      const enabled = rawFlag !== false;
      this.setBoundedCache(
        this.featureCache,
        organizationId,
        enabled,
        FEATURE_CACHE_TTL_MS,
      );
      return enabled;
    } catch (err) {
      this.logger.debug(
        `Could not check system-features for org ${organizationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return true;
    }
  }

  /**
   * Resolves admin moderation rights from JWT claims first, falling back to a cached
   * main-backend staff-role check so newly assigned admins do not wait for re-login.
   */
  async isAdminForOrganization(
    actor: IntranetActor,
    organizationId: string,
  ): Promise<boolean> {
    if (isActorAdminForOrg(actor, organizationId)) {
      return true;
    }
    if (actor.tenantKey !== 'healthystudy' || !actor.rawAuthHeader || !organizationId) {
      return false;
    }

    const cacheKey = `${actor.userId}:${organizationId}`;
    const now = Date.now();
    const cached = this.adminRoleCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    try {
      const res = await fetch(
        `${this.baseUrl}/org-member/my-staff-roles/${encodeURIComponent(organizationId)}`,
        {
          headers: {
            Authorization: actor.rawAuthHeader,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!res.ok) {
        return false;
      }
      const data = (await res.json()) as
        | string[]
        | {
            roleKeys?: string[];
            roles?: Array<string | { roleKey?: string }>;
            branches?: Array<{ roles?: Array<string | { roleKey?: string }> }>;
            isOwner?: boolean;
          };
      const roleList = extractRoleKeysFromStaffRolesResponse(data);
      const isAdmin =
        Boolean(!Array.isArray(data) && data?.isOwner) ||
        roleList.some((r) => STAFF_ADMIN_ROLES.has(r.toLowerCase()));

      this.setBoundedCache(
        this.adminRoleCache,
        cacheKey,
        isAdmin,
        ROLE_CACHE_TTL_MS,
      );
      return isAdmin;
    } catch (err) {
      this.logger.debug(
        `Could not resolve org role from main backend: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  async getOrganizationByUsername(
    username: string,
  ): Promise<OrgSummarySnapshot | null> {
    const clean = username.replace(/^@/, '').trim();
    if (!clean) return null;

    const now = Date.now();
    const cached = this.orgCache.get(clean);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    try {
      const res = await fetch(
        `${this.baseUrl}/organization/view/${encodeURIComponent(clean)}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!res.ok) return null;
      const org = (await res.json()) as Record<string, unknown>;
      const snapshot: OrgSummarySnapshot | null = org?.id
        ? {
            id: String(org.id),
            name: org.name ? String(org.name) : undefined,
            username: org.username ? String(org.username) : clean,
          }
        : null;
      this.setBoundedCache(this.orgCache, clean, snapshot, ORG_CACHE_TTL_MS);
      return snapshot;
    } catch {
      return null;
    }
  }
}
