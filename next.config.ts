import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build output lives under build/ (never committed).
  distDir: "build/next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: {
      // Receipts are resized on the phone; keep a margin for PDFs.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
