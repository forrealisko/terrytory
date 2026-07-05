import type { NextConfig } from "next";
import path from "node:path";

// The Next app lives in website/ but reads its content (published articles,
// niche configs, images) from the sibling system/ folder at runtime. Vercel's
// serverless bundler only ships files it can trace statically, so we explicitly
// include the content tree in every function bundle. Without this, the deployed
// site builds fine but renders empty (no articles found).
const repoRoot = path.join(process.cwd(), "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/**": [
      "../system/niches/**/*.json",
      "../system/content/niches/**/*.json",
      "../system/content/images/**",
      "../system/content/niches/**/images/**",
      "../system/scraper/data/**/*.json",
    ],
  },
};

export default nextConfig;
