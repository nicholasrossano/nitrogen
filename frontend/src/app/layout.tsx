import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Nitrogen',
  description: 'Chat-first climate-impact investment diligence',
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
