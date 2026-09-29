/** @type {import('next').NextConfig} */
const nextConfig = {
  // First-article photos are posted through a Server Action (up to 4 MB, see
  // src/lib/first-article-photo.ts); the default 1 MB action body limit is too small.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
