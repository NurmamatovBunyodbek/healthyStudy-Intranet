import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, LessThan, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { IntranetActor } from '../common/auth/auth.types';
import { MainBackendService } from '../common/services/main-backend.service';
import { IntranetNotificationService } from '../common/services/notification.service';
import { LostFoundClaimEntity } from '../database/entities/lost-found-claim.entity';
import { LostFoundItemEntity } from '../database/entities/lost-found-item.entity';
import {
  CreateLostFoundClaimDto,
  CreateLostFoundItemDto,
  ListLostFoundQueryDto,
  MarkItemReturnedDto,
  ResolveLostFoundClaimDto,
  UpdateLostFoundItemDto,
} from './dto/lost-found.dto';
import {
  SanitizedLostFoundItem,
  computeSmartMatchScore,
  formatNextShelfCode,
  sanitizeItemForViewer,
} from './lost-found.helpers';

const STALE_DAYS_THRESHOLD = 14;
const SMART_MATCH_MIN_SCORE = 4;

@Injectable()
export class LostFoundService {
  private readonly logger = new Logger(LostFoundService.name);

  constructor(
    @InjectRepository(LostFoundItemEntity)
    private readonly itemRepo: Repository<LostFoundItemEntity>,
    @InjectRepository(LostFoundClaimEntity)
    private readonly claimRepo: Repository<LostFoundClaimEntity>,
    private readonly mainBackendService: MainBackendService,
    private readonly notificationService: IntranetNotificationService,
    private readonly configService: ConfigService,
  ) {}

  async listItems(
    query: ListLostFoundQueryDto,
    actor: IntranetActor,
  ): Promise<{
    items: SanitizedLostFoundItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      query.organizationId,
    );

    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      query.organizationId,
    );
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 24)));

    const qb = this.itemRepo
      .createQueryBuilder('item')
      .where('item.tenant_key = :tenantKey', { tenantKey: actor.tenantKey })
      .andWhere('item.organization_id = :organizationId', {
        organizationId: query.organizationId,
      });

    if (query.type) {
      qb.andWhere('item.type = :type', { type: query.type });
    }
    if (query.status) {
      qb.andWhere('item.status = :status', { status: query.status });
    } else if (!query.includeArchived) {
      qb.andWhere('item.status != :archived', { archived: 'archived' });
    }
    if (query.branchId) {
      qb.andWhere('item.branch_id = :branchId', { branchId: query.branchId });
    }
    if (query.category) {
      qb.andWhere('item.category = :category', { category: query.category });
    }
    if (query.mineOnly) {
      qb.andWhere('item.reporter_user_id = :reporterUserId', {
        reporterUserId: actor.userId,
      });
    }
    if (query.search && query.search.trim()) {
      const pattern = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('LOWER(item.title) LIKE :pattern', { pattern })
            .orWhere('LOWER(COALESCE(item.description, \'\')) LIKE :pattern', {
              pattern,
            })
            .orWhere(
              'LOWER(COALESCE(item.location_detail, \'\')) LIKE :pattern',
              { pattern },
            )
            .orWhere('LOWER(COALESCE(item.shelf_code, \'\')) LIKE :pattern', {
              pattern,
            });
        }),
      );
    }

    qb.orderBy('item.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [entities, total] = await qb.getManyAndCount();
    const claimsByItem = await this.loadClaimsMap(entities.map((e) => e.id));

    return {
      items: entities.map((item) =>
        sanitizeItemForViewer(item, {
          viewerUserId: actor.userId,
          isAdmin,
          claims: claimsByItem.get(item.id) || [],
        }),
      ),
      total,
      page,
      limit,
    };
  }

  async getStats(organizationId: string | undefined, actor: IntranetActor) {
    const resolvedOrgId = this.resolveOrgId(organizationId, actor);
    await this.mainBackendService.assertLostFoundEnabled(actor, resolvedOrgId);

    const staleCutoff = new Date(
      Date.now() - STALE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000,
    );

    const [
      openFound,
      openLost,
      claimedCount,
      returnedTotal,
      stale14dCount,
      pendingClaims,
    ] = await Promise.all([
      this.itemRepo.count({
        where: {
          tenant_key: actor.tenantKey,
          organization_id: resolvedOrgId,
          type: 'found',
          status: 'open',
        },
      }),
      this.itemRepo.count({
        where: {
          tenant_key: actor.tenantKey,
          organization_id: resolvedOrgId,
          type: 'lost',
          status: 'open',
        },
      }),
      this.itemRepo.count({
        where: {
          tenant_key: actor.tenantKey,
          organization_id: resolvedOrgId,
          status: 'claimed',
        },
      }),
      this.itemRepo.count({
        where: {
          tenant_key: actor.tenantKey,
          organization_id: resolvedOrgId,
          status: 'returned',
        },
      }),
      this.itemRepo.count({
        where: {
          tenant_key: actor.tenantKey,
          organization_id: resolvedOrgId,
          status: In(['open', 'claimed']),
          created_at: LessThan(staleCutoff),
        },
      }),
      this.claimRepo.count({
        where: {
          tenant_key: actor.tenantKey,
          organization_id: resolvedOrgId,
          status: 'pending',
        },
      }),
    ]);

    return {
      open_found: openFound,
      open_lost: openLost,
      claimed_count: claimedCount,
      returned_total: returnedTotal,
      stale_14d_count: stale14dCount,
      pending_claims: pendingClaims,
    };
  }

  async getItem(
    id: string,
    actor: IntranetActor,
    organizationId?: string,
  ): Promise<SanitizedLostFoundItem> {
    const item = await this.findOwnedItemOrThrow(id, actor.tenantKey, organizationId);
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      item.organization_id,
    );
    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      item.organization_id,
    );
    const claims = await this.claimRepo.find({
      where: { item_id: item.id },
      order: { created_at: 'DESC' },
    });
    return sanitizeItemForViewer(item, {
      viewerUserId: actor.userId,
      isAdmin,
      claims,
    });
  }

  async createItem(
    dto: CreateLostFoundItemDto,
    actor: IntranetActor,
  ): Promise<{
    item: SanitizedLostFoundItem;
    suggested_matches: SanitizedLostFoundItem[];
  }> {
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      dto.organizationId,
    );

    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      dto.organizationId,
    );

    const handedToReception =
      dto.type === 'found' && (Boolean(dto.handedToReception) || isAdmin);
    let shelfCode = dto.shelfCode?.trim() || null;
    if (!shelfCode && handedToReception) {
      shelfCode = await this.generateNextShelfCode(
        actor.tenantKey,
        dto.organizationId,
      );
    }

    const entity = this.itemRepo.create({
      tenant_key: actor.tenantKey,
      organization_id: dto.organizationId,
      branch_id: dto.branchId || null,
      branch_name: dto.branchName || null,
      room_id: dto.roomId || null,
      room_name: dto.roomName || null,
      type: dto.type,
      status: 'open',
      title: dto.title.trim(),
      category: dto.category || 'other',
      description: dto.description?.trim() || null,
      location_detail: dto.locationDetail?.trim() || null,
      incident_at: dto.incidentAt ? new Date(dto.incidentAt) : new Date(),
      image_urls: this.normalizeImageUrls(dto.imageUrls),
      is_sensitive: Boolean(dto.isSensitive),
      secret_note: dto.secretNote?.trim() || null,
      shelf_code: shelfCode,
      handed_to_reception: handedToReception,
      reporter_user_id: actor.userId,
      reporter_name: actor.fullName,
      reporter_role: actor.role,
      reporter_avatar: actor.avatar || null,
      reporter_phone: dto.reporterPhone?.trim() || actor.phone || null,
      external_ref: dto.externalRef?.trim() || null,
      metadata: dto.metadata || null,
    });

    const saved = await this.itemRepo.save(entity);
    const matches = await this.findAndNotifySmartMatches(saved, actor);

    return {
      item: sanitizeItemForViewer(saved, {
        viewerUserId: actor.userId,
        isAdmin,
        claims: [],
      }),
      suggested_matches: matches.map((m) =>
        sanitizeItemForViewer(m, {
          viewerUserId: actor.userId,
          isAdmin,
          claims: [],
        }),
      ),
    };
  }

  async updateItem(
    id: string,
    dto: UpdateLostFoundItemDto,
    actor: IntranetActor,
  ): Promise<SanitizedLostFoundItem> {
    const item = await this.findOwnedItemOrThrow(id, actor.tenantKey);
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      item.organization_id,
    );
    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      item.organization_id,
    );

    if (!isAdmin && item.reporter_user_id !== actor.userId) {
      throw new ForbiddenException(
        'Faqat e’lon muallifi yoki markaz admini tahrirlashi mumkin',
      );
    }

    if (dto.title !== undefined) item.title = dto.title.trim();
    if (dto.category !== undefined) item.category = dto.category;
    if (dto.description !== undefined) {
      item.description = dto.description ? dto.description.trim() : null;
    }
    if (dto.branchId !== undefined) item.branch_id = dto.branchId;
    if (dto.branchName !== undefined) item.branch_name = dto.branchName;
    if (dto.roomId !== undefined) item.room_id = dto.roomId;
    if (dto.roomName !== undefined) item.room_name = dto.roomName;
    if (dto.locationDetail !== undefined) item.location_detail = dto.locationDetail;
    if (dto.imageUrls !== undefined) {
      item.image_urls = this.normalizeImageUrls(dto.imageUrls);
    }
    if (dto.isSensitive !== undefined) item.is_sensitive = dto.isSensitive;
    if (dto.secretNote !== undefined) item.secret_note = dto.secretNote;
    if (dto.handedToReception !== undefined) {
      item.handed_to_reception = dto.handedToReception;
      if (dto.handedToReception && !item.shelf_code) {
        item.shelf_code = await this.generateNextShelfCode(
          actor.tenantKey,
          item.organization_id,
        );
      }
    }
    if (dto.shelfCode !== undefined && isAdmin) {
      item.shelf_code = dto.shelfCode;
    }

    const updated = await this.itemRepo.save(item);
    const claims = await this.claimRepo.find({
      where: { item_id: updated.id },
      order: { created_at: 'DESC' },
    });
    return sanitizeItemForViewer(updated, {
      viewerUserId: actor.userId,
      isAdmin,
      claims,
    });
  }

  async createClaim(
    itemId: string,
    dto: CreateLostFoundClaimDto,
    actor: IntranetActor,
  ): Promise<LostFoundClaimEntity> {
    const item = await this.findOwnedItemOrThrow(itemId, actor.tenantKey);
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      item.organization_id,
    );

    if (item.status === 'returned' || item.status === 'archived') {
      throw new BadRequestException(
        'Ushbu buyum allaqachon egasiga topshirilgan yoki arxivlangan',
      );
    }
    if (item.reporter_user_id === actor.userId) {
      throw new BadRequestException(
        'O‘zingiz joylashtirgan e’longa da’vo yubora olmaysiz',
      );
    }

    const existingPending = await this.claimRepo.findOne({
      where: {
        item_id: item.id,
        claimant_user_id: actor.userId,
        status: In(['pending', 'approved']),
      },
    });
    if (existingPending) {
      throw new BadRequestException(
        'Siz ushbu buyum bo‘yicha allaqachon ariza yuborgansiz',
      );
    }

    const claim = this.claimRepo.create({
      item_id: item.id,
      tenant_key: item.tenant_key,
      organization_id: item.organization_id,
      claim_type:
        dto.claimType || (item.type === 'found' ? 'owner_claim' : 'finder_report'),
      proof_message: dto.proofMessage.trim(),
      proof_image_urls: this.normalizeImageUrls(dto.proofImageUrls),
      contact_phone: dto.contactPhone?.trim() || actor.phone || null,
      claimant_user_id: actor.userId,
      claimant_name: actor.fullName,
      claimant_avatar: actor.avatar || null,
      status: 'pending',
    });

    const savedClaim = await this.claimRepo.save(claim);

    await this.notificationService.dispatch({
      userId: item.reporter_user_id,
      tenantKey: item.tenant_key,
      organizationId: item.organization_id,
      event: 'LOST_FOUND_CLAIM_SUBMITTED',
      title:
        item.type === 'found'
          ? '🔎 Topilgan buyum bo‘yicha da’vo keldi'
          : '🎉 Yo‘qotgan buyumingiz bo‘yicha xabar keldi!',
      message: `${actor.fullName} "${item.title}" yuzasidan isbot yubordi: "${savedClaim.proof_message.slice(0, 90)}"`,
      data: {
        itemId: item.id,
        claimId: savedClaim.id,
        shelfCode: item.shelf_code || null,
      },
    });

    return savedClaim;
  }

  async getAdminQueue(organizationId: string | undefined, actor: IntranetActor) {
    const resolvedOrgId = this.resolveOrgId(organizationId, actor);
    await this.mainBackendService.assertLostFoundEnabled(actor, resolvedOrgId);
    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      resolvedOrgId,
    );
    if (!isAdmin) {
      throw new ForbiddenException('Faqat admin yoki reception xodimi uchun');
    }

    const staleCutoff = new Date(
      Date.now() - STALE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000,
    );

    const [pendingClaims, activeItems, returnedHistory, stats] =
      await Promise.all([
        this.claimRepo.find({
          where: {
            tenant_key: actor.tenantKey,
            organization_id: resolvedOrgId,
            status: 'pending',
          },
          relations: ['item'],
          order: { created_at: 'DESC' },
          take: 100,
        }),
        this.itemRepo.find({
          where: {
            tenant_key: actor.tenantKey,
            organization_id: resolvedOrgId,
            status: In(['open', 'claimed']),
          },
          order: { created_at: 'DESC' },
          take: 150,
        }),
        this.itemRepo.find({
          where: {
            tenant_key: actor.tenantKey,
            organization_id: resolvedOrgId,
            status: In(['returned', 'archived']),
          },
          order: { updated_at: 'DESC' },
          take: 100,
        }),
        this.getStats(resolvedOrgId, actor),
      ]);

    const claimsByItem = await this.loadClaimsMap(
      activeItems.map((i) => i.id),
    );

    return {
      stats,
      pending_claims: pendingClaims.map((claim) => ({
        ...claim,
        item: claim.item
          ? sanitizeItemForViewer(claim.item, {
              viewerUserId: actor.userId,
              isAdmin: true,
            })
          : null,
      })),
      active_items: activeItems.map((item) => ({
        ...sanitizeItemForViewer(item, {
          viewerUserId: actor.userId,
          isAdmin: true,
          claims: claimsByItem.get(item.id) || [],
        }),
        is_stale_14d: item.created_at < staleCutoff,
      })),
      history_items: returnedHistory.map((item) =>
        sanitizeItemForViewer(item, {
          viewerUserId: actor.userId,
          isAdmin: true,
        }),
      ),
    };
  }

  async resolveClaim(
    claimId: string,
    dto: ResolveLostFoundClaimDto,
    actor: IntranetActor,
  ) {
    const claim = await this.claimRepo.findOne({
      where: { id: claimId, tenant_key: actor.tenantKey },
      relations: ['item'],
    });
    if (!claim || !claim.item) {
      throw new NotFoundException('Da’vo topilmadi');
    }

    const item = claim.item;
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      item.organization_id,
    );
    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      item.organization_id,
    );
    if (!isAdmin && item.reporter_user_id !== actor.userId) {
      throw new ForbiddenException(
        'Da’voni faqat markaz admini yoki e’lon muallifi ko‘rib chiqadi',
      );
    }

    claim.status = dto.decision;
    claim.reviewed_by_user_id = actor.userId;
    claim.reviewed_by_name = actor.fullName;
    claim.review_note = dto.reviewNote?.trim() || null;
    claim.reviewed_at = new Date();
    const savedClaim = await this.claimRepo.save(claim);

    if (dto.decision === 'approved') {
      item.status = 'claimed';
      item.approved_claim_id = savedClaim.id;
      if (!item.shelf_code && item.handed_to_reception) {
        item.shelf_code = await this.generateNextShelfCode(
          item.tenant_key,
          item.organization_id,
        );
      }
      await this.itemRepo.save(item);
    }

    await this.notificationService.dispatch({
      userId: claim.claimant_user_id,
      tenantKey: item.tenant_key,
      organizationId: item.organization_id,
      event:
        dto.decision === 'approved'
          ? 'LOST_FOUND_CLAIM_APPROVED'
          : 'LOST_FOUND_CLAIM_REJECTED',
      title:
        dto.decision === 'approved'
          ? '✅ Buyum da’vingiz tasdiqlandi!'
          : 'Da’vingiz rad etildi',
      message:
        dto.decision === 'approved'
          ? `"${item.title}" buyumingiz tasdiqlandi.${item.shelf_code ? ` Polka kodi: ${item.shelf_code}.` : ''} Receptiondan olib ketishingiz mumkin.`
          : `"${item.title}" bo‘yicha yuborgan isbotingiz mos kelmadi.${claim.review_note ? ` Izoh: ${claim.review_note}` : ''}`,
      data: {
        itemId: item.id,
        claimId: savedClaim.id,
        shelfCode: item.shelf_code || null,
      },
    });

    return {
      claim: savedClaim,
      item: sanitizeItemForViewer(item, {
        viewerUserId: actor.userId,
        isAdmin,
      }),
    };
  }

  async markReturned(
    itemId: string,
    dto: MarkItemReturnedDto,
    actor: IntranetActor,
  ): Promise<SanitizedLostFoundItem> {
    const item = await this.findOwnedItemOrThrow(itemId, actor.tenantKey);
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      item.organization_id,
    );
    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      item.organization_id,
    );
    if (!isAdmin && item.reporter_user_id !== actor.userId) {
      throw new ForbiddenException(
        'Faqat reception/admin yoki e’lon muallifi topshirilganini belgilashi mumkin',
      );
    }

    item.status = 'returned';
    item.returned_to_name = dto.returnedToName.trim();
    item.returned_to_phone = dto.returnedToPhone?.trim() || null;
    item.returned_to_user_id = dto.returnedToUserId?.trim() || null;
    item.returned_note = dto.returnedNote?.trim() || null;
    item.returned_at = new Date();
    item.returned_by_user_id = actor.userId;
    item.returned_by_name = actor.fullName;

    const saved = await this.itemRepo.save(item);

    await this.claimRepo.update(
      { item_id: saved.id, status: 'pending' },
      {
        status: 'rejected',
        review_note: 'Buyum egasiga topshirilib yopildi',
        reviewed_by_user_id: actor.userId,
        reviewed_by_name: actor.fullName,
        reviewed_at: new Date(),
      },
    );

    const notifyUserId = saved.returned_to_user_id || saved.reporter_user_id;
    await this.notificationService.dispatch({
      userId: notifyUserId,
      tenantKey: saved.tenant_key,
      organizationId: saved.organization_id,
      event: 'LOST_FOUND_ITEM_RETURNED',
      title: '🤝 Buyum egasiga topshirildi',
      message: `"${saved.title}" (${saved.returned_to_name}) muvaffaqiyatli topshirildi.`,
      data: {
        itemId: saved.id,
        shelfCode: saved.shelf_code || null,
        returnedAt: saved.returned_at?.toISOString() || null,
      },
    });

    const claims = await this.claimRepo.find({ where: { item_id: saved.id } });
    return sanitizeItemForViewer(saved, {
      viewerUserId: actor.userId,
      isAdmin,
      claims,
    });
  }

  async archiveItem(itemId: string, actor: IntranetActor) {
    const item = await this.findOwnedItemOrThrow(itemId, actor.tenantKey);
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      item.organization_id,
    );
    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      item.organization_id,
    );
    if (!isAdmin && item.reporter_user_id !== actor.userId) {
      throw new ForbiddenException('Arxivlash uchun ruxsat yo‘q');
    }

    item.status = 'archived';
    item.archived_at = new Date();
    const saved = await this.itemRepo.save(item);
    return sanitizeItemForViewer(saved, {
      viewerUserId: actor.userId,
      isAdmin,
    });
  }

  async deleteItem(itemId: string, actor: IntranetActor) {
    const item = await this.findOwnedItemOrThrow(itemId, actor.tenantKey);
    await this.mainBackendService.assertLostFoundEnabled(
      actor,
      item.organization_id,
    );
    const isAdmin = await this.mainBackendService.isAdminForOrganization(
      actor,
      item.organization_id,
    );
    if (!isAdmin && item.reporter_user_id !== actor.userId) {
      throw new ForbiddenException('O‘chirish uchun ruxsat yo‘q');
    }

    await this.itemRepo.delete({ id: item.id });
    return { deleted: true, id: item.id };
  }

  @Cron('0 3 * * *')
  async archiveExpiredOpenItems(): Promise<number> {
    const archiveDays =
      this.configService.get<number>('lostFoundArchiveDays') || 45;
    const cutoff = new Date(Date.now() - archiveDays * 24 * 60 * 60 * 1000);

    const res = await this.itemRepo
      .createQueryBuilder()
      .update(LostFoundItemEntity)
      .set({
        status: 'archived',
        archived_at: () => 'CURRENT_TIMESTAMP',
      })
      .where('status = :status', { status: 'open' })
      .andWhere('created_at < :cutoff', { cutoff })
      .execute();

    if ((res.affected || 0) > 0) {
      this.logger.log(
        `Auto-archived ${res.affected} stale Lost & Found items older than ${archiveDays} days`,
      );
    }
    return res.affected || 0;
  }

  private resolveOrgId(
    explicitOrgId: string | undefined,
    actor: IntranetActor,
  ): string {
    const resolved = String(explicitOrgId || actor.organizationId || '').trim();
    if (!resolved) {
      throw new BadRequestException('organizationId parametri talab qilinadi');
    }
    return resolved;
  }

  private async findOwnedItemOrThrow(
    id: string,
    tenantKey: string,
    organizationId?: string,
  ): Promise<LostFoundItemEntity> {
    const where: Record<string, unknown> = { id, tenant_key: tenantKey };
    if (organizationId) {
      where.organization_id = organizationId;
    }
    const item = await this.itemRepo.findOne({ where });
    if (!item) {
      throw new NotFoundException('Buyum topilmadi');
    }
    return item;
  }

  private async loadClaimsMap(
    itemIds: string[],
  ): Promise<Map<string, LostFoundClaimEntity[]>> {
    const map = new Map<string, LostFoundClaimEntity[]>();
    if (itemIds.length === 0) return map;

    const claims = await this.claimRepo.find({
      where: { item_id: In(itemIds) },
      order: { created_at: 'DESC' },
    });
    for (const claim of claims) {
      const list = map.get(claim.item_id) || [];
      list.push(claim);
      map.set(claim.item_id, list);
    }
    return map;
  }

  private async generateNextShelfCode(
    tenantKey: string,
    organizationId: string,
  ): Promise<string> {
    const existing = await this.itemRepo.find({
      where: {
        tenant_key: tenantKey,
        organization_id: organizationId,
        shelf_code: Not(''),
      },
      select: ['shelf_code'],
      order: { created_at: 'DESC' },
      take: 250,
    });
    return formatNextShelfCode(existing.map((e) => e.shelf_code));
  }

  private normalizeImageUrls(urls?: string[]): string[] {
    if (!Array.isArray(urls)) return [];
    return urls
      .map((u) => String(u || '').trim())
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 6);
  }

  private async findAndNotifySmartMatches(
    created: LostFoundItemEntity,
    actor: IntranetActor,
  ): Promise<LostFoundItemEntity[]> {
    const oppositeType = created.type === 'found' ? 'lost' : 'found';
    const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const candidates = await this.itemRepo.find({
      where: {
        tenant_key: created.tenant_key,
        organization_id: created.organization_id,
        type: oppositeType,
        status: 'open',
        created_at: MoreThanOrEqual(recentCutoff),
      },
      order: { created_at: 'DESC' },
      take: 60,
    });

    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: computeSmartMatchScore(created, candidate),
      }))
      .filter((entry) => entry.score >= SMART_MATCH_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const topNotifyTargets = scored
      .map((s) => s.candidate)
      .filter((c) => c.reporter_user_id !== actor.userId)
      .slice(0, 3);

    await Promise.allSettled(
      topNotifyTargets.map((target) =>
        this.notificationService.dispatch({
          userId: target.reporter_user_id,
          tenantKey: created.tenant_key,
          organizationId: created.organization_id,
          event: 'LOST_FOUND_SMART_MATCH',
          title:
            created.type === 'found'
              ? '✨ Yo‘qotgan buyumingizga o‘xshash narsa topildi!'
              : '🔎 Topilgan buyum egasini qidirayotgan bo‘lishi mumkin',
          message: `"${created.title}" (${created.branch_name || 'Markaz'}) sizning "${target.title}" e’loningizga mos kelmoqda.`,
          data: {
            matchedItemId: created.id,
            sourceItemId: target.id,
            shelfCode: created.shelf_code || null,
          },
        }),
      ),
    );

    return scored.map((s) => s.candidate);
  }
}
