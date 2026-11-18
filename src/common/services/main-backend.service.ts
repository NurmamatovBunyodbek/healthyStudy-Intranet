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
const STAFF_ADMIN_ROLES = new Set([
  'superadmin',
  'owner',
  'admin',
  'director',
  'manager',
]);

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
      this.featureCache.set(organizationId, {
        value: enabled,
        expiresAt: now + FEATURE_CACHE_TTL_MS,
      });
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
        | { roleKeys?: string[]; roles?: string[]; isOwner?: boolean };
      const roleList = Array.isArray(data)
        ? data
        : Array.isArray(data?.roleKeys)
          ? data.roleKeys
          : Array.isArray(data?.roles)
            ? data.roles
            : [];
      const isAdmin =
        Boolean(!Array.isArray(data) && data?.isOwner) ||
        roleList.some((r) => STAFF_ADMIN_ROLES.has(String(r).toLowerCase()));

      this.adminRoleCache.set(cacheKey, {
        value: isAdmin,
        expiresAt: now + ROLE_CACHE_TTL_MS,
      });
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
      this.orgCache.set(clean, {
        value: snapshot,
        expiresAt: now + ORG_CACHE_TTL_MS,
      });
      return snapshot;
    } catch {
      return null;
    }
  }
}
