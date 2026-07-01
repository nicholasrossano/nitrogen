/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// CSP allowlist audit (keep in sync when adding third-party integrations):
// - API: connect-src includes NEXT_PUBLIC_API_URL (+ localhost in dev)
// - Firebase auth/storage: *.googleapis.com, *.firebaseio.com, *.firebaseapp.com
// - Google sign-in: accounts.google.com (frame), apis.google.com + gstatic (script)
// - Google Drive Picker: docs.google.com + drive.google.com (frame)
// - Google Fonts: fonts.googleapis.com (style), fonts.gstatic.com (font)
// - PDF/evidence previews: blob: iframes (PdfViewer, ResearchPanel)
// - Map tiles / citation images: img-src https:
// - Stripe checkout: top-level redirect only (no embedded Stripe.js today)
function buildConnectSrc() {
  const sources = [
    "'self'",
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'https://*.cloudfunctions.net',
    'wss://*.firebaseio.com',
  ];

  if (isDev) {
    sources.push(
      'http://localhost:8000',
      'http://127.0.0.1:8000',
      'ws://localhost:8000',
      'ws://127.0.0.1:8000',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    );
  }

  try {
    const parsed = new URL(apiUrl);
    const origin = `${parsed.protocol}//${parsed.host}`;
    if (!sources.includes(origin)) {
      sources.push(origin);
    }
  } catch {
    // ignore invalid NEXT_PUBLIC_API_URL
  }

  return sources.join(' ');
}

const nextConfig = {
  // Vercel expects artifacts in `.next` (routes-manifest.json, etc.).
  // Keep `.next-build` only for local builds to avoid clobbering `next dev`.
  distDir:
    process.env.VERCEL === '1'
      ? '.next'
      : process.env.NITROGEN_NEXT_DIST_DIR || '.next',
  output: 'standalone',
  transpilePackages: ['undici'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https://fonts.gstatic.com",
              `connect-src ${buildConnectSrc()}`,
              "frame-src 'self' blob: https://accounts.google.com https://*.firebaseapp.com https://docs.google.com https://drive.google.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/initiatives/:id',
        destination: '/projects/:id',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
