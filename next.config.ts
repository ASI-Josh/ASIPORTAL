import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  eslint: {
    // ESLint 9 + legacy .eslintrc.json produces a circular-reference serialisation
    // error inside `next lint`. TypeScript (npm run typecheck) is used instead.
    // TODO: migrate to flat config (eslint.config.mjs) to remove this bypass.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
