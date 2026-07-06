/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      // Default is 1mb, silently rejecting the request before the action's
      // own code ever runs (looks like the submit button "does nothing" -
      // hit this with a ~5.4MB campaign export zip, 2026-07-06). Vercel's
      // own serverless function body limit is a hard 4.5MB ceiling that no
      // config can raise, so this is set just under that with headroom -
      // anything bigger than ~4mb (e.g. a campaign with many more portrait
      // images) needs a client-side direct-to-Blob upload instead of a
      // plain server action, not just a bigger number here.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
