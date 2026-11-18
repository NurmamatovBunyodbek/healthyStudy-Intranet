import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { IntranetAuthGuard } from './intranet-auth.guard';
import { IntranetRolesGuard } from './roles.guard';
import { MainBackendService } from '../services/main-backend.service';
import { IntranetNotificationService } from '../services/notification.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret') || '',
      }),
    }),
  ],
  providers: [
    IntranetAuthGuard,
    IntranetRolesGuard,
    MainBackendService,
    IntranetNotificationService,
  ],
  exports: [
    JwtModule,
    IntranetAuthGuard,
    IntranetRolesGuard,
    MainBackendService,
    IntranetNotificationService,
  ],
})
export class CommonAuthModule {}
