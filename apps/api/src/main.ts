// ============================================================
// Arena of 100 - API Entry Point
// NestJS + Fastify + Socket.io
// ============================================================

import { NestFactory, Reflector } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import {
  Logger,
  VersioningType,
  ValidationPipe,
  ClassSerializerInterceptor,
} from "@nestjs/common";
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

  // Security: Helmet (strict CSP, relaxed for Swagger via hook)
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
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
  // Global validation and serialization
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
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

  // Relax CSP for Swagger UI
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/docs")) {
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self';",
      );
    }
  });

  const port = process.env.PORT || 3001;
  await app.listen(port, "0.0.0.0");

  logger.log(`🚀 API Server running on http://localhost:${port}`);
  logger.log(`📚 Swagger documentation: http://localhost:${port}/docs`);
}

bootstrap();
