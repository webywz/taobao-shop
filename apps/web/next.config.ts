import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  experimental: {
    devtoolSegmentExplorer: false
  }
}

export default nextConfig
