// ============================================================
// Test app factory.
//
// Builds a real NestJS + Fastify application instance from
// AppModule, with cross-cutting concerns (CSRF, Throttler,
// Roles) disabled to keep the e2e flow focused on business
// behavior. JWT auth stays real so 401 / auth paths are
// genuinely exercised.
//
// Returns a `TestApp` wrapper that exposes:
//   - inject(opts):    make HTTP calls via Fastify's inject()
//   - authedHeaders(): convenience to build Bearer-token headers
//   - close():         gracefully shut down the app
// ============================================================

import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { CsrfGuard } from "../../src/modules/auth/guards/csrf.guard";
import { RolesGuard } from "../../src/modules/auth/guards/roles.guard";
import * as jwt from "jsonwebtoken";
import { AppModule } from "../../src/app.module";
import { CSRF_TOKEN_COOKIE } from "../../src/modules/auth/auth-cookie";

export interface TestApp {
  app: NestFastifyApplication;
  module: TestingModule;
  inject(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    opts?: { headers?: Record<string, string>; payload?: unknown },
  ): Promise<{
    statusCode: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
    json: <T = unknown>() => T;
  }>;
  authedHeaders(userId: string, username: string): Record<string, string>;
  /**
   * Build headers for a state-changing request (POST/PUT/PATCH/DELETE).
   * Includes the Bearer token AND a valid CSRF token + cookie so
   * the global CsrfGuard is satisfied.
   */
  mutatingHeaders(
    userId: string,
    username: string,
  ): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export interface TokenPayload {
  userId: string;
  username: string;
  role: "GUEST" | "ADMIN";
}

// Guard stub that always passes — used to bypass CSRF, Throttler
// and Roles so e2e specs only validate business logic + auth.
const alwaysPass = { canActivate: () => true };

// Default JWT secret mirrors AuthService's default. Tests that
// override JWT_SECRET in env must also pass it through here.
function jwtSecret(): string {
  return process.env.JWT_SECRET ?? "arena-100-secret-key";
}

export async function createTestApp(): Promise<TestApp> {
  // Global guards (Csrf, Throttler, Roles) are registered in
  // AppModule via APP_GUARD with useClass. We override the three
  // non-auth guards with stubs that always pass so e2e specs focus
  // on business logic, not cross-cutting concerns. JwtAuthGuard
  // stays real so the 401 path is genuinely exercised.
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(CsrfGuard)
    .useValue(alwaysPass)
    .overrideGuard(ThrottlerGuard)
    .useValue(alwaysPass)
    .overrideGuard(RolesGuard)
    .useValue(alwaysPass)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );

  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  // NOTE: no helmet, no swagger, no CORS — the test app stays
  // minimal so failures point to business logic, not infra.

  await app.init();

  return {
    app,
    module: moduleRef,
    async inject(method, url, opts = {}) {
      const fastify = app.getHttpAdapter().getInstance();
      // When a payload is supplied, default to JSON Content-Type so
      // the body parser is invoked. Callers can override.
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (opts.payload !== undefined && !("content-type" in headers)) {
        headers["content-type"] = "application/json";
      }
      const res = await fastify.inject({
        method,
        url,
        headers,
        ...(opts.payload !== undefined
          ? { payload: JSON.stringify(opts.payload) }
          : {}),
      });
      return {
        statusCode: res.statusCode,
        body: res.body,
        headers: res.headers as Record<string, string | string[] | undefined>,
        json: <T>() => res.json() as T,
      };
    },
    authedHeaders(userId, username) {
      const payload: TokenPayload = { userId, username, role: "GUEST" };
      const accessToken = jwt.sign(payload, jwtSecret(), { expiresIn: "1h" });
      return { authorization: `Bearer ${accessToken}` };
    },
    async mutatingHeaders(userId, username) {
      // Get a CSRF token + cookie from the public endpoint.
      const csrfRes = await this.inject("GET", "/api/v1/auth/csrf-token");
      const csrfBody = csrfRes.json<{
        success: boolean;
        data: { csrfToken: string };
      }>();
      const csrfToken = csrfBody.data.csrfToken;

      // Extract the CSRF cookie from Set-Cookie header. Fastify may
      // emit one or more Set-Cookie headers (single string or array).
      const setCookieRaw = csrfRes.headers["set-cookie"];
      const setCookieList = Array.isArray(setCookieRaw)
        ? setCookieRaw
        : setCookieRaw
          ? [setCookieRaw]
          : [];
      // Cookie name is the single source of truth in auth-cookie.ts.
      const csrfCookieLine = setCookieList.find((c) =>
        c.startsWith(`${CSRF_TOKEN_COOKIE}=`),
      );
      if (!csrfCookieLine) {
        throw new Error(
          `auth/csrf-token did not return a CSRF cookie. Got headers: ${JSON.stringify(csrfRes.headers)}`,
        );
      }
      const cookieValue = csrfCookieLine.split(";")[0]!.split("=")[1]!;

      return {
        ...this.authedHeaders(userId, username),
        "x-csrf-token": csrfToken,
        cookie: `${CSRF_TOKEN_COOKIE}=${cookieValue}`,
      };
    },
    async close() {
      await app.close();
    },
  };
}
