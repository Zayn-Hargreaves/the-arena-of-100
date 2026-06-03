# Security Layer: CSRF Protection & Rate Limiting

## Overview

Added server-side CSRF protection and rate limiting to protect state-changing endpoints from cross-site attacks and abuse.

## CSRF Protection (Double Submit Cookie Pattern)

### How It Works

1. **Server sets a `csrf_token` cookie** (non-httpOnly, readable by JS) on login/refresh
2. **Client reads the cookie** and sends the value as `X-CSRF-Token` header on state-changing requests
3. **Server validates** the header value matches the cookie value

This works because:

- Browsers automatically include cookies in requests (even cross-origin)
- But browsers do NOT automatically include custom headers in cross-origin requests without CORS preflight
- An attacker cannot read the cookie from a different origin (same-origin policy), so they cannot set the header

### Implementation

**Backend:**

- `apps/api/src/modules/auth/guards/csrf.guard.ts` — Global guard, validates `X-CSRF-Token` header on POST/PUT/PATCH/DELETE
- `apps/api/src/modules/auth/auth.controller.ts` — `GET /auth/csrf-token` endpoint; CSRF cookie set alongside auth cookies on login/refresh
- `apps/api/src/modules/auth/auth-cookie.ts` — `CSRF_TOKEN_COOKIE`, `generateCsrfToken()` helper
- `apps/api/src/app.module.ts` — `CsrfGuard` registered globally after `JwtAuthGuard`

**Frontend:**

- `apps/web/src/lib/api.ts` — `apiFetch()` reads `csrf_token` from document.cookie and sends as `X-CSRF-Token` header on mutating requests
- `apps/web/src/app/[locale]/admin/page.tsx` — POST requests use `apiFetch` instead of raw `fetch`

### Exceptions

- **Public endpoints** (marked `@Public()`) skip CSRF validation: `/auth/guest`, `/auth/refresh`, `/auth/csrf-token`, `/health/*`
- **GET/HEAD/OPTIONS** requests skip CSRF validation (safe methods)

### When SameSite=None

When `CROSS_SITE_COOKIES=true`, cookies use `SameSite=None` and are vulnerable to CSRF without this guard. The CSRF token cookie uses `SameSite=strict` as defense-in-depth.

---

## Rate Limiting

### Configuration

- **Global**: 100 requests per minute per IP (via `@nestjs/throttler`)
- **Admin sync** (`POST /admin/questions/sync`): 5 requests per minute
- **Admin reset** (`POST /admin/system/reset`): 2 requests per 5 minutes

### Implementation

- `@nestjs/throttler` package installed in `@arena/api`
- `ThrottlerModule.forRoot()` configured in `app.module.ts` with global 100 req/min limit
- `ThrottlerGuard` registered as global guard
- Admin controller uses `@Throttle()` decorator for stricter per-endpoint limits

---

## Pending: Design System Phase 5

Tracked in `progress.md` — not a security issue, but noted:

- Step 5.1: Shell/container templates
- Step 5.2: Legacy cyberpunk CSS cleanup
- Step 5.3: End-to-end visual audit + `pnpm dev` smoke test

## Pending: Profile/Rankings Mock Data

Both pages currently use hardcoded mock data. Needs backend API endpoints (player stats, leaderboard) before real integration.
