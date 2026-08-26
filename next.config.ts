import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Check-in submits client-downscaled walkaround photos (~0.3–0.8MB
      // each) in one multipart action; headroom for a dozen-plus shots.
      bodySizeLimit: "25mb",
    },
  },
};

export default withNextIntl(nextConfig);
