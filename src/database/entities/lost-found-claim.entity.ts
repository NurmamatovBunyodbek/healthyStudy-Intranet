import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LostFoundItemEntity } from './lost-found-item.entity';

export type LostFoundClaimType = 'owner_claim' | 'finder_report';
export type LostFoundClaimStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

@Entity({ name: 'lost_found_claims' })
@Index('IDX_lf_claim_item_status', ['item_id', 'status'])
export class LostFoundClaimEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  item_id!: string;

  @ManyToOne(() => LostFoundItemEntity, (item) => item.claims, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'item_id' })
  item!: LostFoundItemEntity;

  @Index()
  @Column({ type: 'varchar', length: 64, default: 'healthystudy' })
  tenant_key!: string;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  organization_id!: string;

  @Column({ type: 'varchar', length: 24, default: 'owner_claim' })
  claim_type!: LostFoundClaimType;

  @Column({ type: 'text' })
  proof_message!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  proof_image_urls!: string[];

  @Column({ type: 'varchar', length: 64, nullable: true })
  contact_phone?: string | null;

  @Index()
  @Column({ type: 'varchar', length: 128 })
  claimant_user_id!: string;

  @Column({ type: 'varchar', length: 180 })
  claimant_name!: string;

  @Column({ type: 'text', nullable: true })
  claimant_avatar?: string | null;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status!: LostFoundClaimStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  reviewed_by_user_id?: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  reviewed_by_name?: string | null;

  @Column({ type: 'text', nullable: true })
  review_note?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
