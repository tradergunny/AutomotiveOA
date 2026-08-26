import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Photos upload ONE per action everywhere (check-in walkarounds and
      // finding evidence alike) so requests stay inside Vercel's ~4.5 MB
      // serverless body cap. 12 MB keeps headroom for the 10 MB single-file
      // server cap plus multipart overhead when self-hosting.
      bodySizeLimit: "12mb",
    },
  },
};

export default withNextIntl(nextConfig);
