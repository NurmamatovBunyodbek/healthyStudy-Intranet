import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IntranetActor } from './auth.types';
import { ROLES_METADATA_KEY } from './decorators';
import { isActorAdminForOrg } from './intranet-auth.guard';

@Injectable()
export class IntranetRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: IntranetActor;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
      params?: Record<string, unknown>;
    }>();
    const actor = request.user;
    if (!actor) {
      throw new ForbiddenException('Authentication required');
    }

    if (actor.isInternalService || actor.isPlatformAdmin) {
      return true;
    }

    const targetOrgId = String(
      request.query?.organizationId ||
        request.body?.organizationId ||
        request.params?.organizationId ||
        actor.organizationId ||
        '',
    ).trim();

    if (isActorAdminForOrg(actor, targetOrgId || undefined)) {
      return true;
    }

    // For item-level moderation routes (`PATCH /lost-found/:id/return`), org ownership is validated in service
    const requiresAdminOnly = requiredRoles.every((r) =>
      ['superadmin', 'admin', 'owner', 'staff'].includes(r.toLowerCase()),
    );
    if (
      requiresAdminOnly &&
      !targetOrgId &&
      actor.authType === 'jwt' &&
      (actor.ownedOrgIds.length > 0 ||
        Object.values(actor.orgRoles).some((roles) =>
          roles.some((r) => ['superadmin', 'owner', 'admin', 'director', 'manager'].includes(r)),
        ))
    ) {
      return true;
    }

    throw new ForbiddenException(
      'Bu amalni bajarish uchun markaz administrator huquqi talab qilinadi',
    );
  }
}
