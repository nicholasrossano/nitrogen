import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Nitrogen AI',
  description: 'Chat-first climate-impact investment diligence and technical assistance',
};

/** Explicit viewport so mobile browsers do not render at a ~980px desktop width. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
