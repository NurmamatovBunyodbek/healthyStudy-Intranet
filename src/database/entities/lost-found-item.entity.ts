import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LostFoundClaimEntity } from './lost-found-claim.entity';

export type LostFoundItemType = 'found' | 'lost';
export type LostFoundItemStatus = 'open' | 'claimed' | 'returned' | 'archived';
export type LostFoundCategory =
  | 'electronics'
  | 'documents'
  | 'accessories'
  | 'study'
  | 'clothing'
  | 'keys'
  | 'wallet'
  | 'other';

@Entity({ name: 'lost_found_items' })
@Index('IDX_lf_tenant_org_status', [
  'tenant_key',
  'organization_id',
  'status',
  'type',
  'created_at',
])
export class LostFoundItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64, default: 'healthystudy' })
  tenant_key!: string;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  organization_id!: string;

  @Index()
  @Column({ type: 'varchar', length: 128, nullable: true })
  branch_id?: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  branch_name?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  room_id?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  room_name?: string | null;

  @Column({ type: 'varchar', length: 16 })
  type!: LostFoundItemType;

  @Column({ type: 'varchar', length: 24, default: 'open' })
  status!: LostFoundItemStatus;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 48, default: 'other' })
  category!: LostFoundCategory;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location_detail?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  incident_at?: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  image_urls!: string[];

  @Column({ type: 'boolean', default: false })
  is_sensitive!: boolean;

  @Column({ type: 'text', nullable: true })
  secret_note?: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  shelf_code?: string | null;

  @Column({ type: 'boolean', default: false })
  handed_to_reception!: boolean;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  reporter_user_id!: string;

  @Column({ type: 'varchar', length: 180 })
  reporter_name!: string;

  @Column({ type: 'varchar', length: 48, nullable: true })
  reporter_role?: string | null;

  @Column({ type: 'text', nullable: true })
  reporter_avatar?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reporter_phone?: string | null;

  @Column({ type: 'uuid', nullable: true })
  approved_claim_id?: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  returned_to_name?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  returned_to_phone?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  returned_to_user_id?: string | null;

  @Column({ type: 'text', nullable: true })
  returned_note?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  returned_at?: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  returned_by_user_id?: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  returned_by_name?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at?: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  external_ref?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @OneToMany(() => LostFoundClaimEntity, (claim) => claim.item)
  claims?: LostFoundClaimEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
