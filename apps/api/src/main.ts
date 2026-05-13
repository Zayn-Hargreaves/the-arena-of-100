// ============================================================
// Arena of 100 - API Entry Point
// NestJS + Fastify + Socket.io
// ============================================================

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { Logger, ValidationPipe, VersioningType } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "@fastify/helmet";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
    }),
  );

  // Security: Helmet (relax CSP for Swagger UI requirements)
  await app.register(helmet as any, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
      },
    },
  });

  // Enable CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix("api");

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle("Arena of 100 API")
    .setDescription(
      "The core API for the real-time multiplayer quiz battle royale game.",
    )
    .setVersion("1.0")
    .addTag("Arena")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port, "0.0.0.0");

  logger.log(`🚀 API Server running on http://localhost:${port}`);
  logger.log(`📚 Swagger documentation: http://localhost:${port}/docs`);
}

bootstrap();
