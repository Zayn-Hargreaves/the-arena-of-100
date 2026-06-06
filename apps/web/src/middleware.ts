import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except for
  // - API routes
  // - Static files/assets (e.g. public folder images)
  // - Next.js internal paths (_next)
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
