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

const CSRF_HEADER = "x-csrf-token";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Skip non-mutating methods
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      return true;
    }

    // Public endpoints don't need CSRF (login, refresh, health)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Verify the CSRF token header is present and matches the cookie value
    const headerToken = request.headers[CSRF_HEADER];
    if (!headerToken) {
      throw new ForbiddenException("Missing CSRF token header");
    }

    const cookieToken = request.cookies?.csrf_token;
    if (!cookieToken || headerToken !== cookieToken) {
      throw new ForbiddenException("Invalid CSRF token");
    }

    return true;
  }
}
