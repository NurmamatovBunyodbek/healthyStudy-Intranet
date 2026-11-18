import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { CommonAuthModule } from './common/auth/auth.module';
import { intranetConfiguration } from './common/config/configuration';
import { DatabaseModule } from './database/database.module';
import { LostFoundModule } from './lost-found/lost-found.module';
import { MediaModule } from './media/media.module';
import { WeatherModule } from './weather/weather.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [intranetConfiguration],
    }),
    ScheduleModule.forRoot(),
    CacheModule.register({
      isGlobal: true,
      ttl: 10 * 60 * 1000, // 10 minutes
      max: 500,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 300,
        },
      ],
    }),
    DatabaseModule,
    CommonAuthModule,
    MediaModule,
    WeatherModule,
    LostFoundModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
