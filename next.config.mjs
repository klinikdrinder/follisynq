/** Static export: the whole app is a client-side PWA so it can run fully offline on iPad.
 *  Vercel only serves static files — no clinical media or patient data passes through Vercel servers. */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};
export default nextConfig;
