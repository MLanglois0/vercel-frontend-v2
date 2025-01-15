/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.r2.cloudflarestorage.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.public.blob.vercel-storage.com',
      }
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb'
    },
  },
}

module.exports = nextConfig 