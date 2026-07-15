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
  ClassSerializerInterceptor,
} from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "@fastify/helmet";
import { RedisIoAdapter } from "./adapters/redis-io.adapter";

const APP_CLOSE_TIMEOUT_MS = 10000;

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
  // Body/query validation is per-handler via ZodValidationPipe.
  // A global class-validator ValidationPipe would reject every field
  // (forbidNonWhitelisted) because DTOs intentionally have no
  // class-validator decorators.
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

  // Cross-node Socket.IO fan-out. Must be installed BEFORE app.listen()
  // so the gateway's Server is built through the Redis adapter. With the
  // default in-memory adapter, room broadcasts only reach sockets on the
  // same instance; the multi-instance topology (docker-compose.multi.yml)
  // needs this to deliver ROUND_STARTED/etc. across nodes.
  const redisIoAdapter = new RedisIoAdapter(app);

  // Register shutdown handlers BEFORE startup (connectToRedis/listen) begins so
  // a SIGTERM/SIGINT that lands mid-boot still tears everything down. The Redis
  // adapter's dedicated pub/sub connections must be closed so they don't leak on
  // a graceful stop (e.g. `docker stop`); `disconnect()` optional-chains its
  // pub/sub clients, so it is a safe no-op when connectToRedis never ran.
  //
  // Startup and shutdown share one lifecycle: `shuttingDown` gates further
  // startup progress (checked after each `await`), and `gracefulShutdown` waits
  // for the in-flight startup step to settle (`startupSettled`) before running
  // cleanup so `app.close()` never races an in-progress `app.listen()` and the
  // Socket.IO adapter connect/disconnect stay coordinated server-side.
  // Each cleanup step is guarded independently and any failure surfaces as a
  // non-zero exit code; we set `process.exitCode` instead of forcing
  // `process.exit()` so the event loop drains naturally after cleanup.
  let shuttingDown = false;
  const describeError = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  // Run startup as a single settleable unit. After each await we bail out if a
  // shutdown has begun, so we never listen on / advertise a server that is
  // about to be torn down; gracefulShutdown awaits this before cleaning up.
  // The IIFE runs synchronously up to its first await (connectToRedis), so the
  // signal handlers below are registered before control yields.
  const startupSettled: Promise<void> = (async () => {
    await redisIoAdapter.connectToRedis(
      process.env.REDIS_URL || "redis://localhost:6379",
      process.env.REDIS_KEY_PREFIX,
    );
    if (shuttingDown) return; // shutdown started during connect — don't listen
    app.useWebSocketAdapter(redisIoAdapter);

    const port = process.env.PORT || 3001;
    await app.listen(port, "0.0.0.0");
    if (shuttingDown) {
      // Signal landed during listen(); gracefulShutdown will app.close() the
      // socket we just opened once this promise settles.
      logger.warn(
        "Shutdown began during startup; server will close immediately",
      );
      return;
    }

    logger.log(`🚀 API Server running on http://localhost:${port}`);
    logger.log(`📚 Swagger documentation: http://localhost:${port}/docs`);
  })();

  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal}, shutting down`);
    // Let any in-flight startup step finish (or fail) first — cleanup must run
    // only after startup has settled, never concurrently with it.
    await startupSettled.catch(() => {});
    let hadError = false;
    // Close the app (HTTP + Socket.IO server) BEFORE quitting the Redis
    // clients: the server's per-namespace RedisAdapters publish and
    // unsubscribe through those clients, so quitting first would leave the
    // draining server broadcasting into dead connections.
    //
    // Bound the wait like the adapter's quitWithTimeout: a close() that hangs
    // (e.g. a connection that never drains) must not wedge shutdown before
    // the Redis clients are released. A losing app.close() rejection is
    // already observed by Promise.race, so it can't become unhandled.
    try {
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          app.close(),
          new Promise<never>((_, reject) => {
            closeTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    `app.close() timed out after ${APP_CLOSE_TIMEOUT_MS}ms`,
                  ),
                ),
              APP_CLOSE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(closeTimer);
      }
    } catch (err) {
      hadError = true;
      logger.error(`App close failed: ${describeError(err)}`);
    }
    try {
      await redisIoAdapter.disconnect();
    } catch (err) {
      hadError = true;
      logger.error(`Redis adapter disconnect failed: ${describeError(err)}`);
    }
    if (hadError) process.exitCode = 1;
  };
  process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.once("SIGINT", () => void gracefulShutdown("SIGINT"));

  await startupSettled;
}

bootstrap();
