import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildTypeOrmOptions, ensureDatabaseExists } from './data-source';

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
          false,
        );
        const autoCreate = configService.get<boolean>(
          'database.autoCreate',
          false,
        );
        const migrationsRun = configService.get<boolean>(
          'database.migrationsRun',
          true,
        );
        const ssl = configService.get<boolean>('database.ssl', false);
        const nodeEnv = configService.get<string>('nodeEnv', 'development');

        await ensureDatabaseExists({
          url: dbUrl,
          host,
          port,
          name,
          user,
          pass,
          autoCreate,
          ssl,
        });

        return buildTypeOrmOptions({
          url: dbUrl,
          host,
          port,
          name,
          user,
          pass,
          synchronize,
          migrationsRun,
          ssl,
          nodeEnv,
        });
      },
    }),
  ],
})
export class DatabaseModule {}
