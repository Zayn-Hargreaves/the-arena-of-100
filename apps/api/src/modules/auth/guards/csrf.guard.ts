// ============================================================
// CSRF Guard - Custom Header Pattern (SPA-friendly)
// State-changing requests (POST, PUT, PATCH, DELETE) must
// include a custom header that browsers won't send
// automatically in cross-origin requests.
// ============================================================

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { CSRF_EXEMPT_KEY } from "../../../common/decorators/csrf-exempt.decorator";
import { CSRF_TOKEN_COOKIE, getCookieValue } from "../auth-cookie";

const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Skip non-mutating methods
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isCsrfExempt = this.reflector.getAllAndOverride<boolean>(
      CSRF_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Explicit CSRF exemption always wins.
    if (isCsrfExempt) {
      return true;
    }

    // Public routes still require CSRF on mutating methods unless the
    // method itself is safe (defense-in-depth for auth/guest/refresh).
    if (isPublic && SAFE_METHODS.includes(request.method)) {
      return true;
    }

    // Verify the CSRF token header is present and matches the cookie value
    const headerToken = request.headers[CSRF_HEADER];
    if (!headerToken) {
      throw new ForbiddenException("Missing CSRF token header");
    }

    const cookieToken = getCookieValue(
      request.headers.cookie,
      CSRF_TOKEN_COOKIE,
    );
    if (!cookieToken || headerToken !== cookieToken) {
      throw new ForbiddenException("Invalid CSRF token");
    }

    return true;
  }
}
