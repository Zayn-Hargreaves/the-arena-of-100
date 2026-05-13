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
import { AuthService } from "../auth.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.replace("Bearer ", "").trim()
      : undefined;

    if (!token) {
      throw new UnauthorizedException(
        "Missing or invalid authorization header",
      );
    }

    try {
      this.authService.verifyToken(token);
      return true;
    } catch (error) {
      // Log original error for debugging while returning generic message for security
      this.logger.error("JWT verification failed", error instanceof Error ? error.stack : String(error));
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
