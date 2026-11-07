import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy (docs/security.md §4). Scripts load only from this origin and
 * Stripe. 'unsafe-inline' stays in script-src because partially prerendered pages ship
 * inline bootstrap scripts in a static shell that is built once, so a per-request nonce
 * cannot be added to them; everything else (objects, framing, base, forms, connections) is
 * locked down. Development adds 'unsafe-eval' and websockets for hot reload.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://js.stripe.com${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.stripe.com",
  "font-src 'self'",
  `connect-src 'self' https://api.stripe.com https://*.stripe.com${dev ? " ws: wss:" : ""}`,
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")' },
  // Browsers ignore HSTS over plain HTTP, so this is harmless on localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/** Signed-in pages carry personal data: never store them in a browser or shared cache. */
const privatePages = ["/account/:path*", "/bookings/:path*", "/dashboard/:path*", "/dashboard", "/provider/:path*", "/provider", "/admin/:path*", "/admin"];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...privatePages.map((source) => ({ source, headers: [{ key: "Cache-Control", value: "private, no-store" }] })),
    ];
  },
  // pg and the BullMQ stack are Node-only; keep them out of the bundler.
  serverExternalPackages: ["pg", "bullmq", "ioredis", "pino", "sharp"],
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
