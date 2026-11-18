import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntranetActor } from '../common/auth/auth.types';
import { MainBackendService } from '../common/services/main-backend.service';
import { IntranetNotificationService } from '../common/services/notification.service';
import { LostFoundClaimEntity } from '../database/entities/lost-found-claim.entity';
import { LostFoundItemEntity } from '../database/entities/lost-found-item.entity';
import {
  computeSmartMatchScore,
  formatNextShelfCode,
  sanitizeItemForViewer,
} from './lost-found.helpers';
import { LostFoundService } from './lost-found.service';

describe('LostFoundHelpers & Service', () => {
  const makeActor = (overrides: Partial<IntranetActor> = {}): IntranetActor => ({
    userId: 'user-student-1',
    fullName: 'Ali Valiyev',
    phone: '+998901234567',
    role: 'student',
    platformRoles: ['student'],
    ownedOrgIds: [],
    orgRoles: {},
    tenantKey: 'healthystudy',
    organizationId: 'org-1',
    authType: 'jwt',
    isPlatformAdmin: false,
    isInternalService: false,
    ...overrides,
  });

  const makeItem = (
    overrides: Partial<LostFoundItemEntity> = {},
  ): LostFoundItemEntity =>
    ({
      id: 'item-1',
      tenant_key: 'healthystudy',
      organization_id: 'org-1',
      branch_id: 'branch-1',
      branch_name: 'Main Branch',
      room_id: 'room-1',
      room_name: '204',
      type: 'found',
      status: 'open',
      title: 'Humo bank kartasi',
      category: 'documents',
      description: 'Kassa oldidan topildi',
      location_detail: '1-qavat reception yonida',
      incident_at: new Date(),
      image_urls: ['https://ik.imagekit.io/demo/secret-card.jpg'],
      is_sensitive: true,
      secret_note: 'Oxirgi 4 raqami 4419',
      shelf_code: '#LF-101',
      handed_to_reception: true,
      reporter_user_id: 'admin-1',
      reporter_name: 'Reception',
      reporter_phone: '+998909998877',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    }) as LostFoundItemEntity;

  describe('sanitizeItemForViewer', () => {
    it('masks sensitive photos, secret_note, and reporter_phone for unverified viewers', () => {
      const sanitized = sanitizeItemForViewer(makeItem(), {
        viewerUserId: 'stranger-99',
        isAdmin: false,
        claims: [],
      });

      expect(sanitized.secret_note).toBeNull();
      expect(sanitized.photos_locked).toBe(true);
      expect(sanitized.hidden_photo_count).toBe(1);
      expect(sanitized.image_urls).toEqual([]);
      expect(sanitized.reporter_phone).not.toBe('+998909998877');
    });

    it('reveals photos and contact to approved claimant while keeping secret_note internal', () => {
      const claim = {
        id: 'claim-1',
        item_id: 'item-1',
        claimant_user_id: 'owner-1',
        status: 'approved',
        proof_message: 'Oxirgi 4 raqam 4419',
        claim_type: 'owner_claim',
        created_at: new Date(),
      } as LostFoundClaimEntity;

      const sanitized = sanitizeItemForViewer(makeItem(), {
        viewerUserId: 'owner-1',
        isAdmin: false,
        claims: [claim],
      });

      expect(sanitized.photos_locked).toBe(false);
      expect(sanitized.image_urls).toEqual([
        'https://ik.imagekit.io/demo/secret-card.jpg',
      ]);
      expect(sanitized.reporter_phone).toBe('+998909998877');
      expect(sanitized.secret_note).toBeNull();
    });

    it('reveals secret_note and full claim list to organization admin', () => {
      const sanitized = sanitizeItemForViewer(makeItem(), {
        viewerUserId: 'admin-2',
        isAdmin: true,
        claims: [],
      });

      expect(sanitized.secret_note).toBe('Oxirgi 4 raqami 4419');
      expect(sanitized.image_urls).toHaveLength(1);
      expect(sanitized.can_moderate).toBe(true);
    });
  });

  describe('formatNextShelfCode & SmartMatch', () => {
    it('increments highest existing #LF shelf tag cleanly', () => {
      expect(formatNextShelfCode([])).toBe('#LF-101');
      expect(formatNextShelfCode(['#LF-101', '#LF-109', '#LF-104'])).toBe(
        '#LF-110',
      );
    });

    it('scores matching category, branch, and keywords strongly', () => {
      const found = makeItem({
        type: 'found',
        category: 'electronics',
        branch_id: 'br-main',
        title: 'Oq Apple AirPods Pro zaryad qutisi',
        description: '204-xonada stol ustida qolgan',
      });
      const lostMatch = makeItem({
        type: 'lost',
        category: 'electronics',
        branch_id: 'br-main',
        title: 'AirPods Pro quloqchinim yo‘qoldi',
        description: 'Main filial 204',
      });
      const unrelated = makeItem({
        type: 'lost',
        category: 'clothing',
        branch_id: 'br-other',
        title: 'Qora kurtka',
        description: 'Kirish eshigi',
        location_detail: '2-bino foye',
      });

      expect(computeSmartMatchScore(found, lostMatch)).toBeGreaterThanOrEqual(9);
      expect(computeSmartMatchScore(found, unrelated)).toBe(0);
    });
  });

  describe('LostFoundService guards & handover', () => {
    const createMockService = () => {
      const itemRepo = {
        findOne: jest.fn(),
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((x) => ({ id: 'item-new', created_at: new Date(), updated_at: new Date(), ...x })),
        save: jest.fn(async (x) => x),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        delete: jest.fn(),
        createQueryBuilder: jest.fn(),
      };
      const claimRepo = {
        findOne: jest.fn(),
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((x) => ({ id: 'claim-new', created_at: new Date(), ...x })),
        save: jest.fn(async (x) => x),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      };
      const mainBackendService = {
        assertLostFoundEnabled: jest.fn().mockResolvedValue(undefined),
        isAdminForOrganization: jest.fn().mockResolvedValue(false),
      } as unknown as MainBackendService;
      const notificationService = {
        dispatch: jest.fn().mockResolvedValue(undefined),
      } as unknown as IntranetNotificationService;
      const configService = {
        get: jest.fn().mockReturnValue(45),
      } as unknown as ConfigService;

      const service = new LostFoundService(
        itemRepo as never,
        claimRepo as never,
        mainBackendService,
        notificationService,
        configService,
      );

      return { service, itemRepo, claimRepo, mainBackendService, notificationService };
    };

    it('blocks claiming your own item', async () => {
      const { service, itemRepo } = createMockService();
      itemRepo.findOne.mockResolvedValue(
        makeItem({ reporter_user_id: 'user-student-1' }),
      );

      await expect(
        service.createClaim(
          'item-1',
          { proofMessage: 'Bu meniki' },
          makeActor({ userId: 'user-student-1' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks duplicate pending claims from same user', async () => {
      const { service, itemRepo, claimRepo } = createMockService();
      itemRepo.findOne.mockResolvedValue(makeItem({ reporter_user_id: 'other' }));
      claimRepo.findOne.mockResolvedValue({ id: 'existing', status: 'pending' });

      await expect(
        service.createClaim(
          'item-1',
          { proofMessage: 'Yana urinib ko‘raman' },
          makeActor({ userId: 'user-student-1' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('dispatches smart match notification when matching opposite item exists', async () => {
      const { service, itemRepo, notificationService } = createMockService();
      itemRepo.find.mockResolvedValue([
        makeItem({
          id: 'lost-1',
          type: 'lost',
          category: 'electronics',
          branch_id: 'branch-1',
          title: 'AirPods Pro yo‘qotdim',
          reporter_user_id: 'student-owner-7',
        }),
      ]);

      const result = await service.createItem(
        {
          organizationId: 'org-1',
          type: 'found',
          title: 'Oq AirPods Pro topildi',
          category: 'electronics',
          branchId: 'branch-1',
        },
        makeActor({ userId: 'teacher-5', role: 'teacher' }),
      );

      expect(result.suggested_matches).toHaveLength(1);
      expect(notificationService.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'student-owner-7',
          event: 'LOST_FOUND_SMART_MATCH',
        }),
      );
    });

    it('prevents non-admin non-reporter from getting admin queue', async () => {
      const { service } = createMockService();
      await expect(
        service.getAdminQueue('org-1', makeActor()),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
