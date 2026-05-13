import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@arena/shared"],
  reactStrictMode: true,
};

export default nextConfig;
