import path from "node:path";
import type { NextConfig } from "next";

// Where the Rust API runs. Baked into the rewrite at build time (the container sets it to localhost).
const API = process.env.API_URL ?? "http://localhost:8787";

const config: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};
export default config;
