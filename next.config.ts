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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Approval buttons must never be framed by another site (clickjacking).
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Receipts are resized on the phone; keep a margin for PDFs.
      // 4 MB files plus multipart overhead (Vercel rejects bodies over 4.5 MB).
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
