import type { NextConfig } from "next";

const API = process.env.API_URL ?? "http://localhost:8787";

const config: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
export default config;
