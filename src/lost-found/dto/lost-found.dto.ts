import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  LostFoundCategory,
  LostFoundItemStatus,
  LostFoundItemType,
} from '../../database/entities/lost-found-item.entity';
import type { LostFoundClaimType } from '../../database/entities/lost-found-claim.entity';

export const LOST_FOUND_TYPES = ['found', 'lost'] as const;
export const LOST_FOUND_STATUSES = [
  'open',
  'claimed',
  'returned',
  'archived',
] as const;
export const LOST_FOUND_CATEGORIES = [
  'electronics',
  'documents',
  'accessories',
  'study',
  'clothing',
  'keys',
  'wallet',
  'other',
] as const;
export const CLAIM_TYPES = ['owner_claim', 'finder_report'] as const;

export class ListLostFoundQueryDto {
  @ApiProperty({ description: 'Organization or tenant workspace identifier' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  organizationId!: string;

  @ApiPropertyOptional({ enum: LOST_FOUND_TYPES })
  @IsOptional()
  @IsIn(LOST_FOUND_TYPES)
  type?: LostFoundItemType;

  @ApiPropertyOptional({ enum: LOST_FOUND_STATUSES })
  @IsOptional()
  @IsIn(LOST_FOUND_STATUSES)
  status?: LostFoundItemStatus;

  @ApiPropertyOptional({ enum: LOST_FOUND_CATEGORIES })
  @IsOptional()
  @IsIn(LOST_FOUND_CATEGORIES)
  category?: LostFoundCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Return only items created by current actor' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  mineOnly?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateLostFoundItemDto {
  @ApiProperty({ description: 'Organization or workspace identifier' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  organizationId!: string;

  @ApiProperty({ enum: LOST_FOUND_TYPES })
  @IsIn(LOST_FOUND_TYPES)
  type!: LostFoundItemType;

  @ApiProperty({ example: 'Oq Apple AirPods Pro' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ enum: LOST_FOUND_CATEGORIES, default: 'other' })
  @IsOptional()
  @IsIn(LOST_FOUND_CATEGORIES)
  category?: LostFoundCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  branchName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  roomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  roomName?: string;

  @ApiPropertyOptional({ example: '2-qavat, 204-xona stoli ustida' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationDetail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  incidentAt?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 6 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  imageUrls?: string[];

  @ApiPropertyOptional({
    description: 'Blurs/locks photos from unverified users (cards, phones, IDs)',
  })
  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @ApiPropertyOptional({
    description: 'Private verification detail hidden from public view',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  secretNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  handedToReception?: boolean;

  @ApiPropertyOptional({ description: 'Optional custom reception tag like #LF-104' })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  shelfCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reporterPhone?: string;

  @ApiPropertyOptional({ description: 'Optional reference ID from external system' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateLostFoundItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: LOST_FOUND_CATEGORIES })
  @IsOptional()
  @IsIn(LOST_FOUND_CATEGORIES)
  category?: LostFoundCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  branchId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  branchName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  roomId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  roomName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationDetail?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 6 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  imageUrls?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  secretNote?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  handedToReception?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(24)
  shelfCode?: string | null;
}

export class CreateLostFoundClaimDto {
  @ApiPropertyOptional({ enum: CLAIM_TYPES, default: 'owner_claim' })
  @IsOptional()
  @IsIn(CLAIM_TYPES)
  claimType?: LostFoundClaimType;

  @ApiProperty({ example: 'G‘ilofi orqasida ko‘k stiker va tirnalish bor' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  proofMessage!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 4 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  proofImageUrls?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  contactPhone?: string;
}

export class ResolveLostFoundClaimDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}

export class MarkItemReturnedDto {
  @ApiProperty({ example: 'Jasur Alimov' })
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  returnedToName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  returnedToPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  returnedToUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnedNote?: string;
}
