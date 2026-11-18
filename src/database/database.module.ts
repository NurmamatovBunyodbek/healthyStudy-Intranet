import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from 'pg';
import { LostFoundClaimEntity } from './entities/lost-found-claim.entity';
import { LostFoundItemEntity } from './entities/lost-found-item.entity';

const SAFE_PG_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function ensureDatabaseExists(opts: {
  url?: string;
  host: string;
  port: number;
  name: string;
  user: string;
  pass: string;
  autoCreate: boolean;
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
    logger.debug(
      `Skipped auto-creating database "${opts.name}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const dbUrl = configService.get<string>('database.url');
        const host = configService.get<string>('database.host', 'localhost');
        const port = configService.get<number>('database.port', 5432);
        const name = configService.get<string>(
          'database.name',
          'healthystudy_intranet_db',
        );
        const user = configService.get<string>('database.user', 'postgres');
        const pass = configService.get<string>('database.pass', 'root');
        const synchronize = configService.get<boolean>(
          'database.synchronize',
          true,
        );
        const autoCreate = configService.get<boolean>(
          'database.autoCreate',
          true,
        );
        const nodeEnv = configService.get<string>('nodeEnv', 'development');

        await ensureDatabaseExists({
          url: dbUrl,
          host,
          port,
          name,
          user,
          pass,
          autoCreate,
        });

        const baseOptions = {
          type: 'postgres' as const,
          synchronize,
          entities: [LostFoundItemEntity, LostFoundClaimEntity],
          ssl:
            nodeEnv === 'production' && dbUrl
              ? { rejectUnauthorized: false }
              : false,
          extra: {
            max: 15,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          },
          logging:
            nodeEnv === 'development'
              ? (['error', 'warn'] as ('error' | 'warn')[])
              : false,
        };

        return dbUrl
          ? { ...baseOptions, url: dbUrl }
          : {
              ...baseOptions,
              host,
              port,
              database: name,
              username: user,
              password: pass,
            };
      },
    }),
  ],
})
export class DatabaseModule {}
