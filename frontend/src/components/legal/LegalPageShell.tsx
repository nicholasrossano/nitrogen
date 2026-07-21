import Link from 'next/link';
import Image from 'next/image';
import nitrogenIcon from '@/app/icon.png';

/** Shared chrome for public legal pages (Terms, Privacy) — unauthenticated, no app shell. */
export function LegalPageShell({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="h-[72px] px-6 flex items-center justify-between border-b border-stroke-subtle">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src={nitrogenIcon} alt="" width={28} height={28} className="rounded-md" priority />
          <span className="text-lg font-display font-semibold text-text-primary tracking-tight">
            Nitrogen AI
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-text-secondary">
          <Link href="/legal/terms" className="hover:text-accent transition-colors">
            Terms
          </Link>
          <Link href="/legal/privacy" className="hover:text-accent transition-colors">
            Privacy
          </Link>
        </nav>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-display font-semibold text-text-primary mb-1">{title}</h1>
        <p className="text-sm text-text-tertiary mb-8">Last updated: {lastUpdated}</p>
        <div className="prose-memo max-w-none">{children}</div>
      </main>
    </div>
  );
}
