import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { AppModule } from "./app.module";
import { UsersModule } from "./modules/users/users.module";
import { RankingsModule } from "./modules/rankings/rankings.module";
import { GameGateway } from "./gateways/game.gateway";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { RolesGuard } from "./modules/auth/guards/roles.guard";
import { CsrfGuard } from "./modules/auth/guards/csrf.guard";
import { ThrottlerGuard } from "@nestjs/throttler";

describe("AppModule", () => {
  it("includes UsersModule and RankingsModule in @Module imports", () => {
    const imports = Reflect.getMetadata("imports", AppModule) as unknown[];
    expect(imports).toContain(UsersModule);
    expect(imports).toContain(RankingsModule);
  });

  it("registers the global WebSocket gateway as a provider", () => {
    const providers = Reflect.getMetadata("providers", AppModule) as unknown[];
    const providerTokens = providers.map((p) =>
      typeof p === "object" && p !== null && "useClass" in p
        ? (p as { useClass: unknown }).useClass
        : p,
    );
    expect(providerTokens).toContain(GameGateway);
  });

  it("registers JwtAuthGuard, RolesGuard, CsrfGuard and ThrottlerGuard as APP_GUARD", () => {
    const providers = Reflect.getMetadata("providers", AppModule) as Array<
      unknown | { provide: unknown; useClass: unknown }
    >;
    const guardClasses = providers
      .filter(
        (p): p is { provide: unknown; useClass: unknown } =>
          typeof p === "object" && p !== null && "useClass" in p,
      )
      .map((p) => p.useClass);
    expect(guardClasses).toContain(JwtAuthGuard);
    expect(guardClasses).toContain(RolesGuard);
    expect(guardClasses).toContain(CsrfGuard);
    expect(guardClasses).toContain(ThrottlerGuard);
  });
});
