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

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException(
        "Missing or invalid authorization header",
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    if (!token || !token.trim()) {
      throw new UnauthorizedException(
        "Missing or invalid authorization header",
      );
    }

    try {
      const payload = await this.authService.verifyToken(token);
      // Attach user info to request for use in controllers
      request.user = payload;
      return true;
    } catch (error) {
      // Log original error for debugging while returning generic message for security
      this.logger.error("JWT verification failed:", error);
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
