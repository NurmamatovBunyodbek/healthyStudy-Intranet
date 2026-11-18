import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IntranetActor } from '../auth/auth.types';
import { IntranetRolesGuard } from '../auth/roles.guard';
import {
  MainBackendService,
  extractRoleKeysFromStaffRolesResponse,
} from './main-backend.service';

describe('MainBackendService & IntranetRolesGuard', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const makeActor = (overrides: Partial<IntranetActor> = {}): IntranetActor => ({
    userId: 'user-1',
    fullName: 'Dilshod Karimov',
    role: 'user',
    platformRoles: ['user'],
    ownedOrgIds: [],
    orgRoles: {},
    tenantKey: 'healthystudy',
    organizationId: 'org-1',
    authType: 'jwt',
    isPlatformAdmin: false,
    isInternalService: false,
    rawAuthHeader: 'Bearer test-jwt',
    ...overrides,
  });

  describe('extractRoleKeysFromStaffRolesResponse', () => {
    it('extracts roleKey entries from Main Backend branches payload', () => {
      const roles = extractRoleKeysFromStaffRolesResponse({
        branches: [
          {
            branchId: 'br-1',
            branchName: 'Main Branch',
            roles: [
              { id: 'r1', roleKey: 'admin', scope: 'branch' },
              { id: 'r2', roleKey: 'teacher', scope: 'module' },
            ],
          },
        ],
      });

      expect(roles).toEqual(['admin', 'teacher']);
    });

    it('supports legacy flat arrays and roleKeys objects', () => {
      expect(extractRoleKeysFromStaffRolesResponse(['superadmin'])).toEqual([
        'superadmin',
      ]);
      expect(
        extractRoleKeysFromStaffRolesResponse({ roleKeys: ['manager'] }),
      ).toEqual(['manager']);
    });
  });

  describe('MainBackendService.isAdminForOrganization', () => {
    const createService = () => {
      const configService = {
        get: jest.fn((key: string) => {
          if (key === 'mainBackendUrl') return 'http://127.0.0.1:3000';
          if (key === 'internalServiceSecret') return 'cb-internal-secret-2026';
          return undefined;
        }),
      } as unknown as ConfigService;

      return new MainBackendService(configService);
    };

    it('grants admin rights when Main Backend returns branches[].roles[].roleKey = admin', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          branches: [
            {
              branchId: 'main',
              branchName: 'Main Branch',
              roles: [{ id: '1', roleKey: 'admin', scope: 'branch' }],
            },
          ],
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = createService();
      const allowed = await service.isAdminForOrganization(makeActor(), 'org-1');

      expect(allowed).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/org-member/my-staff-roles/org-1',
        expect.any(Object),
      );
    });

    it('denies admin rights when Main Backend returns only student/teacher roles or empty branches', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          branches: [
            {
              branchId: 'main',
              roles: [{ id: '1', roleKey: 'teacher', scope: 'branch' }],
            },
          ],
        }),
      }) as unknown as typeof fetch;

      const service = createService();
      await expect(
        service.isAdminForOrganization(makeActor(), 'org-1'),
      ).resolves.toBe(false);
    });
  });

  describe('IntranetRolesGuard', () => {
    const makeContext = (
      actor: IntranetActor,
      query: Record<string, unknown> = { organizationId: 'org-1' },
    ): ExecutionContext =>
      ({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            user: actor,
            query,
            body: {},
            params: {},
          }),
        }),
      }) as unknown as ExecutionContext;

    it('falls back to MainBackendService when JWT claims do not yet reflect newly assigned admin role', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(['superadmin', 'admin']),
      } as unknown as Reflector;
      const mainBackendService = {
        isAdminForOrganization: jest.fn().mockResolvedValue(true),
      } as unknown as MainBackendService;

      const guard = new IntranetRolesGuard(reflector, mainBackendService);
      const allowed = await guard.canActivate(makeContext(makeActor()));

      expect(allowed).toBe(true);
      expect(mainBackendService.isAdminForOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'org-1',
      );
    });

    it('rejects non-admin when both JWT claims and MainBackendService deny access', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(['superadmin', 'admin']),
      } as unknown as Reflector;
      const mainBackendService = {
        isAdminForOrganization: jest.fn().mockResolvedValue(false),
      } as unknown as MainBackendService;

      const guard = new IntranetRolesGuard(reflector, mainBackendService);
      await expect(guard.canActivate(makeContext(makeActor()))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
