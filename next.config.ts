import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables Docker-optimized build with minimal standalone output
  output: 'standalone',
  // Allow large LiDAR .las file uploads (files can be several GB)
  experimental: {
    serverActions: {
      bodySizeLimit: '4gb',
    },
  },
  async headers() {
    return [
      {
        // Binary point cloud tiles (.bin, .laz, .las) — disable browser caching
        // to prevent ERR_CACHE_OPERATION_NOT_SUPPORTED in Potree iframes
        source: '/:path*.(bin|laz|las)',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
      },
      {
        // Potree viewer HTML + JSON metadata — also no-cache so changes appear immediately
        source: '/potree_custom/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;
