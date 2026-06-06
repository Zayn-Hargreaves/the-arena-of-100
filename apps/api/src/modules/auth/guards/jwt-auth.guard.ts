// ============================================================
// JWT Auth Guard - Protects routes with JWT verification
// ============================================================

import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  CanActivate,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "../auth.service";
import { IS_PUBLIC_KEY } from "../../../common/decorators/public.decorator";
import { ACCESS_TOKEN_COOKIE, getCookieValue } from "../auth-cookie";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const headerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : undefined;
    const cookieToken = getCookieValue(
      request.headers.cookie,
      ACCESS_TOKEN_COOKIE,
    );
    const token = headerToken ?? cookieToken ?? undefined;

    if (!token) {
      throw new UnauthorizedException(
        "Missing or invalid authorization header",
      );
    }

    try {
      const payload = this.authService.verifyToken(token);

      if (
        !payload ||
        typeof payload !== "object" ||
        !("userId" in payload) ||
        !("username" in payload)
      ) {
        throw new UnauthorizedException("Invalid token payload");
      }

      request.user = payload;

      return true;
    } catch (error) {
      // Log original error for debugging while returning generic message for security
      this.logger.error(
        "JWT verification failed",
        error instanceof Error ? error.stack : String(error),
      );
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
