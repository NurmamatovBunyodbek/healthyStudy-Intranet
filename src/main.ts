import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = Number(configService.get<string>('PORT', '3004')) || 3004;
  const rawCors = configService.get<string>(
    'CORS_ORIGINS',
    'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176',
  );
  const configuredOrigins = rawCors
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: [
      ...configuredOrigins,
      'https://coursebazaar.uz',
      /\.coursebazaar\.uz$/,
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'x-internal-secret',
      'x-api-key',
      'x-tenant-id',
      'x-app-key',
      'x-organization-id',
      'x-org-id',
      'x-user-id',
      'x-user-name',
      'x-user-role',
      'x-user-phone',
    ],
    exposedHeaders: ['Date'],
  });

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  const swaggerEnabled =
    configService.get<string>('SWAGGER_ENABLED', 'true').toLowerCase() !==
    'false';
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('HealthyStudy Intranet Microservice')
      .setDescription(
        'Reusable Intranet REST API (Weather, Lost & Found, Media Upload Auth)',
      )
      .setVersion('1.1')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'x-api-key')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(port, '0.0.0.0');
  logger.log(`Intranet Microservice running on port ${port}`);
}

bootstrap();
