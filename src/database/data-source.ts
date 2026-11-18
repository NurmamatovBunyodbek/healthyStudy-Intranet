import { Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { DataSource, DataSourceOptions } from 'typeorm';
import { intranetConfiguration } from '../common/config/configuration';
import { LostFoundClaimEntity } from './entities/lost-found-claim.entity';
import { LostFoundItemEntity } from './entities/lost-found-item.entity';
import { InitLostFoundTables1700000000000 } from './migrations/1700000000000-InitLostFoundTables';

const SAFE_PG_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export async function ensureDatabaseExists(opts: {
  url?: string;
  host: string;
  port: number;
  name: string;
  user: string;
  pass: string;
  autoCreate: boolean;
  ssl: boolean;
}): Promise<void> {
  if (!opts.autoCreate || opts.url) {
    return;
  }
  if (!SAFE_PG_IDENTIFIER.test(opts.name)) {
    throw new Error(`Unsafe PostgreSQL database name: ${opts.name}`);
  }

  const logger = new Logger('DatabaseBootstrap');
  const client = new Client({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.pass,
    database: 'postgres',
    ssl: opts.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 4000,
  });

  try {
    await client.connect();
    const check = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [opts.name],
    );
    if (check.rowCount === 0) {
      await client.query(`CREATE DATABASE "${opts.name}"`);
      logger.log(`Created missing PostgreSQL database "${opts.name}"`);
    }
  } catch (err) {
    logger.warn(
      `Skipped auto-creating database "${opts.name}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function loadEnvIfPresent(filePath = resolve(process.cwd(), '.env')): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export interface BuildTypeOrmOptionsInput {
  url?: string;
  host: string;
  port: number;
  name: string;
  user: string;
  pass: string;
  synchronize: boolean;
  migrationsRun: boolean;
  ssl: boolean;
  nodeEnv: string;
}

export function buildTypeOrmOptions(
  opts: BuildTypeOrmOptionsInput,
): DataSourceOptions {
  const baseOptions = {
    type: 'postgres' as const,
    synchronize: opts.synchronize,
    migrationsRun: opts.migrationsRun,
    entities: [LostFoundItemEntity, LostFoundClaimEntity],
    migrations: [InitLostFoundTables1700000000000],
    ssl: opts.ssl ? { rejectUnauthorized: false } : false,
    extra: {
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
    logging:
      opts.nodeEnv === 'development'
        ? (['error', 'warn'] as ('error' | 'warn')[])
        : false,
  };

  return opts.url
    ? { ...baseOptions, url: opts.url }
    : {
        ...baseOptions,
        host: opts.host,
        port: opts.port,
        database: opts.name,
        username: opts.user,
        password: opts.pass,
      };
}

export async function ensureDatabaseFromEnv(): Promise<void> {
  loadEnvIfPresent();
  const db = intranetConfiguration().database;
  await ensureDatabaseExists({
    url: db.url,
    host: db.host,
    port: db.port,
    name: db.name,
    user: db.user,
    pass: db.pass,
    autoCreate: db.autoCreate,
    ssl: db.ssl,
  });
}

loadEnvIfPresent();
const cfg = intranetConfiguration();

export const AppDataSource = new DataSource(
  buildTypeOrmOptions({
    url: cfg.database.url,
    host: cfg.database.host,
    port: cfg.database.port,
    name: cfg.database.name,
    user: cfg.database.user,
    pass: cfg.database.pass,
    synchronize: false,
    migrationsRun: false,
    ssl: cfg.database.ssl,
    nodeEnv: cfg.nodeEnv,
  }),
);
