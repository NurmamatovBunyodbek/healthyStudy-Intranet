import { LostFoundClaimEntity } from '../database/entities/lost-found-claim.entity';
import { LostFoundItemEntity } from '../database/entities/lost-found-item.entity';

const STOP_WORDS = new Set([
  'bilan',
  'uchun',
  'topildi',
  'yoqoldi',
  'xona',
  'xonada',
  'qavat',
  'qavatda',
  'yonida',
  'oldida',
  'ichida',
  'ustida',
  'reception',
  'filial',
  'filialda',
  'markaz',
  'markazda',
  'narsa',
  'buyum',
  'rang',
  'with',
  'from',
  'lost',
  'found',
  'room',
  'floor',
  'near',
  'the',
  'and',
]);

export function normalizeTextTokens(text?: string | null): Set<string> {
  const tokens = new Set<string>();
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/['"`ʻ’]/g, '')
    .replace(/[^a-z0-9а-яё\s]/gi, ' ');
  for (const part of cleaned.split(/\s+/)) {
    if (part.length >= 3 && !STOP_WORDS.has(part)) {
      tokens.add(part);
    }
  }
  return tokens;
}

export function computeSmartMatchScore(
  source: Pick<
    LostFoundItemEntity,
    'category' | 'branch_id' | 'title' | 'description' | 'location_detail'
  >,
  candidate: Pick<
    LostFoundItemEntity,
    'category' | 'branch_id' | 'title' | 'description' | 'location_detail'
  >,
): number {
  let score = 0;

  if (source.category && candidate.category === source.category) {
    score += 4;
  }
  if (source.branch_id && candidate.branch_id && source.branch_id === candidate.branch_id) {
    score += 3;
  }

  const sourceTokens = normalizeTextTokens(
    `${source.title || ''} ${source.description || ''} ${source.location_detail || ''}`,
  );
  const candidateTokens = normalizeTextTokens(
    `${candidate.title || ''} ${candidate.description || ''} ${candidate.location_detail || ''}`,
  );

  let overlapCount = 0;
  for (const token of sourceTokens) {
    if (candidateTokens.has(token)) {
      overlapCount += 1;
    }
  }
  score += Math.min(overlapCount, 4) * 2;

  return score;
}

export function formatNextShelfCode(existingCodes: Array<string | null | undefined>): string {
  let maxNumber = 100;
  for (const code of existingCodes) {
    if (!code) continue;
    const match = String(code).match(/#?LF-(\d+)/i);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > maxNumber) {
        maxNumber = parsed;
      }
    }
  }
  return `#LF-${maxNumber + 1}`;
}

export function maskPhoneNumber(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (trimmed.length <= 4) return '****';
  return `${trimmed.slice(0, Math.min(4, trimmed.length - 2))}***${trimmed.slice(-2)}`;
}

export interface SanitizedLostFoundItem {
  id: string;
  tenant_key: string;
  organization_id: string;
  branch_id: string | null;
  branch_name: string | null;
  room_id: string | null;
  room_name: string | null;
  type: LostFoundItemEntity['type'];
  status: LostFoundItemEntity['status'];
  title: string;
  category: LostFoundItemEntity['category'];
  description: string | null;
  location_detail: string | null;
  incident_at: Date | null;
  image_urls: string[];
  photos_locked: boolean;
  hidden_photo_count: number;
  is_sensitive: boolean;
  secret_note: string | null;
  shelf_code: string | null;
  handed_to_reception: boolean;
  reporter_user_id: string;
  reporter_name: string;
  reporter_role: string | null;
  reporter_avatar: string | null;
  reporter_phone: string | null;
  approved_claim_id: string | null;
  returned_to_name: string | null;
  returned_to_phone: string | null;
  returned_to_user_id: string | null;
  returned_note: string | null;
  returned_at: Date | null;
  returned_by_user_id: string | null;
  returned_by_name: string | null;
  archived_at: Date | null;
  external_ref: string | null;
  metadata: Record<string, unknown> | null;
  can_moderate: boolean;
  is_reporter: boolean;
  viewer_claim: Partial<LostFoundClaimEntity> | null;
  claims_count: number;
  pending_claims_count: number;
  claims?: LostFoundClaimEntity[];
  created_at: Date;
  updated_at: Date;
}

/**
 * Strips private verification details (`secret_note`, raw sensitive photos, phone numbers)
 * from responses returned to unverified viewers so fraudsters cannot inspect network payloads.
 */
export function sanitizeItemForViewer(
  item: LostFoundItemEntity,
  opts: {
    viewerUserId?: string;
    isAdmin: boolean;
    claims?: LostFoundClaimEntity[];
  },
): SanitizedLostFoundItem {
  const allClaims = Array.isArray(opts.claims)
    ? opts.claims
    : Array.isArray(item.claims)
      ? item.claims
      : [];
  const isReporter = Boolean(
    opts.viewerUserId && item.reporter_user_id === opts.viewerUserId,
  );
  const canModerate = Boolean(opts.isAdmin || isReporter);
  const viewerClaim =
    opts.viewerUserId
      ? allClaims.find((c) => c.claimant_user_id === opts.viewerUserId) || null
      : null;
  const hasApprovedClaim = viewerClaim?.status === 'approved';
  const canSeeLockedMedia = canModerate || hasApprovedClaim;

  const rawImages = Array.isArray(item.image_urls) ? item.image_urls : [];
  const photosLocked = Boolean(item.is_sensitive && !canSeeLockedMedia && rawImages.length > 0);
  const visibleImages = item.is_sensitive && !canSeeLockedMedia ? [] : rawImages;
  const pendingClaimsCount = allClaims.filter((c) => c.status === 'pending').length;

  return {
    id: item.id,
    tenant_key: item.tenant_key,
    organization_id: item.organization_id,
    branch_id: item.branch_id ?? null,
    branch_name: item.branch_name ?? null,
    room_id: item.room_id ?? null,
    room_name: item.room_name ?? null,
    type: item.type,
    status: item.status,
    title: item.title,
    category: item.category,
    description: item.description ?? null,
    location_detail: item.location_detail ?? null,
    incident_at: item.incident_at ?? null,
    image_urls: visibleImages,
    photos_locked: photosLocked,
    hidden_photo_count: photosLocked ? rawImages.length : 0,
    is_sensitive: Boolean(item.is_sensitive),
    secret_note: canModerate ? item.secret_note ?? null : null,
    shelf_code: item.shelf_code ?? null,
    handed_to_reception: Boolean(item.handed_to_reception),
    reporter_user_id: item.reporter_user_id,
    reporter_name: item.reporter_name,
    reporter_role: item.reporter_role ?? null,
    reporter_avatar: item.reporter_avatar ?? null,
    reporter_phone: canSeeLockedMedia
      ? item.reporter_phone ?? null
      : maskPhoneNumber(item.reporter_phone),
    approved_claim_id: item.approved_claim_id ?? null,
    returned_to_name: canModerate ? item.returned_to_name ?? null : null,
    returned_to_phone: canModerate ? item.returned_to_phone ?? null : null,
    returned_to_user_id: canModerate ? item.returned_to_user_id ?? null : null,
    returned_note: canModerate ? item.returned_note ?? null : null,
    returned_at: item.returned_at ?? null,
    returned_by_user_id: canModerate ? item.returned_by_user_id ?? null : null,
    returned_by_name: canModerate ? item.returned_by_name ?? null : null,
    archived_at: item.archived_at ?? null,
    external_ref: item.external_ref ?? null,
    metadata: item.metadata ?? null,
    can_moderate: canModerate,
    is_reporter: isReporter,
    viewer_claim: viewerClaim
      ? {
          id: viewerClaim.id,
          claim_type: viewerClaim.claim_type,
          proof_message: viewerClaim.proof_message,
          status: viewerClaim.status,
          review_note: viewerClaim.review_note ?? null,
          created_at: viewerClaim.created_at,
        }
      : null,
    claims_count: allClaims.length,
    pending_claims_count: pendingClaimsCount,
    claims: canModerate ? allClaims : undefined,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}
