import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Session pages read the auth cookie on every request.
  cacheComponents: false,
  partialPrefetching: false,
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
