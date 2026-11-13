import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  output: "standalone",
  experimental: {
    serverActions: {
      // Allow large LiDAR .las file uploads (files can be several GB)
      bodySizeLimit: "4gb",
    },
  },
  async headers() {
    return [
      {
        // Binary point cloud tiles — disable browser caching to prevent
        // ERR_CACHE_OPERATION_NOT_SUPPORTED in Potree iframes
        source: "/:path*.(bin|laz|las)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
      {
        // Allow the frontend (different origin) to read static files
        source: "/(nubes_procesadas|nube_procesada|ortofotos|planos)/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
