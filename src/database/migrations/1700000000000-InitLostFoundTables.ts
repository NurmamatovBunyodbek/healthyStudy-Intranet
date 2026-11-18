import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitLostFoundTables1700000000000 implements MigrationInterface {
  name = 'InitLostFoundTables1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lost_found_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_key" character varying(64) NOT NULL DEFAULT 'healthystudy',
        "organization_id" character varying(128) NOT NULL,
        "branch_id" character varying(128),
        "branch_name" character varying(180),
        "room_id" character varying(128),
        "room_name" character varying(120),
        "type" character varying(16) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'open',
        "title" character varying(200) NOT NULL,
        "category" character varying(48) NOT NULL DEFAULT 'other',
        "description" text,
        "location_detail" character varying(255),
        "incident_at" TIMESTAMP WITH TIME ZONE,
        "image_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "is_sensitive" boolean NOT NULL DEFAULT false,
        "secret_note" text,
        "shelf_code" character varying(24),
        "handed_to_reception" boolean NOT NULL DEFAULT false,
        "reporter_user_id" character varying(128) NOT NULL,
        "reporter_name" character varying(180) NOT NULL,
        "reporter_role" character varying(48),
        "reporter_avatar" text,
        "reporter_phone" character varying(64),
        "approved_claim_id" uuid,
        "returned_to_name" character varying(180),
        "returned_to_phone" character varying(64),
        "returned_to_user_id" character varying(128),
        "returned_note" text,
        "returned_at" TIMESTAMP WITH TIME ZONE,
        "returned_by_user_id" character varying(128),
        "returned_by_name" character varying(180),
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "external_ref" character varying(128),
        "metadata" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lost_found_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_tenant_org_status" ON "lost_found_items" ("tenant_key", "organization_id", "status", "type", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_items_tenant_key" ON "lost_found_items" ("tenant_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_items_organization_id" ON "lost_found_items" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_items_branch_id" ON "lost_found_items" ("branch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_items_reporter_user_id" ON "lost_found_items" ("reporter_user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lost_found_claims" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "item_id" uuid NOT NULL,
        "tenant_key" character varying(64) NOT NULL DEFAULT 'healthystudy',
        "organization_id" character varying(128) NOT NULL,
        "claim_type" character varying(24) NOT NULL DEFAULT 'owner_claim',
        "proof_message" text NOT NULL,
        "proof_image_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "contact_phone" character varying(64),
        "claimant_user_id" character varying(128) NOT NULL,
        "claimant_name" character varying(180) NOT NULL,
        "claimant_avatar" text,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "reviewed_by_user_id" character varying(128),
        "reviewed_by_name" character varying(180),
        "review_note" text,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lost_found_claims" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_claim_item_status" ON "lost_found_claims" ("item_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_claims_item_id" ON "lost_found_claims" ("item_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_claims_tenant_key" ON "lost_found_claims" ("tenant_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_claims_organization_id" ON "lost_found_claims" ("organization_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_claims_claimant_user_id" ON "lost_found_claims" ("claimant_user_id")`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE t.relname = 'lost_found_claims'
            AND n.nspname = current_schema()
            AND c.contype = 'f'
        ) THEN
          ALTER TABLE "lost_found_claims"
            ADD CONSTRAINT "FK_lost_found_claims_item"
            FOREIGN KEY ("item_id") REFERENCES "lost_found_items"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lost_found_claims"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lost_found_items"`);
  }
}
