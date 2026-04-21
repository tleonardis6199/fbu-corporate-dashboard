/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Let Vercel catch errors, don't block dev
    ignoreBuildErrors: false,
  },
};
module.exports = nextConfig;
