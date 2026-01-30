import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wisterion - Decision Packet Studio',
  description: 'Generate investment memos through conversational AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-background">
          {children}
        </div>
      </body>
    </html>
  );
}
