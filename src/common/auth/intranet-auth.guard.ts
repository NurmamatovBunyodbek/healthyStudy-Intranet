import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { IntranetActor } from './auth.types';
import { OPTIONAL_AUTH_METADATA_KEY } from './decorators';

const DEFAULT_TENANT_KEY = 'healthystudy';
const PLATFORM_ADMIN_ROLES = new Set(['platform_superadmin']);
const STAFF_ADMIN_ROLES = new Set(['superadmin', 'owner', 'admin', 'director', 'manager']);

function safeSecretEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function normalizeTenantKey(value?: string | null): string {
  const clean = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return clean || DEFAULT_TENANT_KEY;
}

function normalizeRoleArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean);
}

function normalizeOrgRoles(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map: Record<string, string[]> = {};
  for (const [orgId, roles] of Object.entries(raw as Record<string, unknown>)) {
    const cleanOrg = String(orgId || '').trim();
    if (!cleanOrg) continue;
    map[cleanOrg] = normalizeRoleArray(roles);
  }
  return map;
}

/**
 * Checks whether an actor holds admin/reception moderation privileges for the target organization.
 */
export function isActorAdminForOrg(
  actor: IntranetActor | undefined,
  organizationId?: string,
): boolean {
  if (!actor) return false;
  if (actor.isInternalService || actor.isPlatformAdmin) return true;
  if (actor.authType === 'api_key') {
    return STAFF_ADMIN_ROLES.has(actor.role);
  }

  const targetOrg = String(organizationId || actor.organizationId || '').trim();
  if (targetOrg) {
    if (actor.ownedOrgIds.includes(targetOrg)) return true;
    const rolesInOrg = actor.orgRoles[targetOrg] || [];
    if (rolesInOrg.some((r) => STAFF_ADMIN_ROLES.has(r))) return true;
  }

  return false;
}

@Injectable()
export class IntranetAuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: IntranetActor }>();
    const optionalAuth = this.reflector.getAllAndOverride<boolean>(
      OPTIONAL_AUTH_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    const headerOrgId = this.firstHeader(request, ['x-organization-id', 'x-org-id']);
    const headerTenant = this.firstHeader(request, ['x-tenant-id', 'x-app-key']);

    // 1. Service-to-service M2M secret
    const internalSecret = this.firstHeader(request, ['x-internal-secret']);
    const expectedSecret =
      this.configService.get<string>('internalServiceSecret') || '';
    if (internalSecret && expectedSecret && safeSecretEquals(internalSecret, expectedSecret)) {
      const userId =
        this.firstHeader(request, ['x-user-id']) ||
        '00000000-0000-0000-0000-000000000000';
      const userName = this.firstHeader(request, ['x-user-name']) || 'Internal Service';
      request.user = {
        userId,
        fullName: userName,
        role: 'superadmin',
        platformRoles: ['superadmin'],
        ownedOrgIds: headerOrgId ? [headerOrgId] : [],
        orgRoles: {},
        tenantKey: normalizeTenantKey(headerTenant),
        organizationId: headerOrgId || undefined,
        authType: 'internal',
        isPlatformAdmin: true,
        isInternalService: true,
      };
      return true;
    }

    // 2. External REST API Key (`x-api-key`) scoped to a dedicated tenant key
    const apiKey = this.firstHeader(request, ['x-api-key']);
    const apiKeyMap =
      this.configService.get<Map<string, string>>('externalApiKeys') || new Map();
    if (apiKey) {
      const mappedTenant = apiKeyMap.get(apiKey);
      if (!mappedTenant) {
        throw new UnauthorizedException('Invalid API key');
      }
      const userRole = (
        this.firstHeader(request, ['x-user-role']) || 'admin'
      ).toLowerCase();
      const actorId =
        this.firstHeader(request, ['x-user-id']) || `api:${mappedTenant}`;
      const actorName =
        this.firstHeader(request, ['x-user-name']) || `${mappedTenant} Integration`;
      const actorPhone = this.firstHeader(request, ['x-user-phone']) || undefined;
      request.user = {
        userId: actorId,
        fullName: actorName,
        phone: actorPhone,
        role: userRole,
        platformRoles: [userRole],
        ownedOrgIds: [],
        orgRoles: {},
        tenantKey: normalizeTenantKey(mappedTenant),
        organizationId: headerOrgId || undefined,
        authType: 'api_key',
        isPlatformAdmin: false,
        isInternalService: false,
      };
      return true;
    }

    // 3. Bearer JWT or HttpOnly auth cookie (HealthyStudy / compatible JWT callers)
    const token = this.extractToken(request);
    if (!token) {
      if (optionalAuth) return true;
      throw new UnauthorizedException('Authentication token or API key required');
    }

    const jwtSecret = this.configService.get<string>('jwt.secret') || '';
    if (!jwtSecret) {
      throw new UnauthorizedException('JWT configuration is missing');
    }

    try {
      const payload = await this.jwtService.verifyAsync<Record<string, unknown>>(
        token,
        { secret: jwtSecret },
      );
      const userId = String(payload?.sub || payload?.id || '').trim();
      if (!userId) {
        throw new UnauthorizedException('Invalid token payload');
      }

      const platformRoles = normalizeRoleArray(
        payload.roles || payload.membershipRoles,
      );
      const primaryRole = String(
        payload.role || platformRoles[0] || 'user',
      ).toLowerCase();
      const ownedOrgIds = normalizeRoleArray(payload.ownedOrgIds);
      const orgRoles = normalizeOrgRoles(payload.orgRoles);
      const fullName =
        String(payload.fullName || '').trim() ||
        [payload.name, payload.surname].filter(Boolean).join(' ').trim() ||
        'Foydalanuvchi';
      const payloadOrgId = String(
        headerOrgId || payload.organizationId || payload.orgId || '',
      ).trim();

      request.user = {
        userId,
        fullName,
        phone: payload.phone ? String(payload.phone) : undefined,
        avatar: payload.avatar ? String(payload.avatar) : undefined,
        role: primaryRole,
        platformRoles,
        ownedOrgIds,
        orgRoles,
        tenantKey: normalizeTenantKey(
          (payload.tenantKey as string | undefined) || headerTenant,
        ),
        organizationId: payloadOrgId || undefined,
        authType: 'jwt',
        isPlatformAdmin: platformRoles.some((r) => PLATFORM_ADMIN_ROLES.has(r)),
        isInternalService: false,
        rawAuthHeader: token ? `Bearer ${token}` : undefined,
      };
      return true;
    } catch (err) {
      if (optionalAuth) return true;
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Invalid or expired token',
      );
    }
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const raw = authHeader.slice(7).trim();
      if (raw) return raw;
    }
    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.token || cookies?.auth_token || cookies?.access_token || null;
  }

  private firstHeader(request: Request, names: string[]): string | undefined {
    for (const name of names) {
      const val = request.headers?.[name];
      if (typeof val === 'string' && val.trim()) {
        return val.trim();
      }
      if (Array.isArray(val) && val[0]?.trim()) {
        return val[0].trim();
      }
    }
    return undefined;
  }
}
