import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  transpilePackages: ["@arena/shared"],
  reactStrictMode: true,
};

export default withNextIntl(nextConfig);
