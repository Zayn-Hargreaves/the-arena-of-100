// ============================================================
// Arena of 100 - API Entry Point
// NestJS + Fastify + Socket.io
// ============================================================

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
    }),
  );

  // Enable CORS
  app.enableCors({
    origin: process.env['CORS_ORIGIN'] || 'http://localhost:3000',
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  const port = process.env['PORT'] || 3001;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 API Server running on http://localhost:${port}`);
  logger.log(`🎮 Game WebSocket ready on ws://localhost:${port}`);
}

bootstrap();