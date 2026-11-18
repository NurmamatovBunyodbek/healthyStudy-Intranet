import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly configService: ConfigService) {}

  @Get('health')
  @SkipThrottle()
  @ApiOperation({ summary: 'Microservice health check' })
  getHealth() {
    return {
      status: 'ok',
      service: 'healthystudy-intranet-service',
      port: Number(this.configService.get<string>('PORT', '3004')) || 3004,
      timestamp: new Date().toISOString(),
    };
  }
}
