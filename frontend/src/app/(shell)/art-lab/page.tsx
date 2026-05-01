'use client';

import { useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ShellPageHeader } from '@/components/ui';
import { LoadingArtHost, getLoadingArtById, loadingArtRegistry } from '@/components/ui/loading-art';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';

function LoadingArtLabContent() {
  const router = useRouter();
  const showArtLab = useFeatureFlag('art_lab');
  const [selectedArtId, setSelectedArtId] = useState<string>(loadingArtRegistry[0]?.id ?? '');

  const selectedArt = useMemo(
    () => getLoadingArtById(selectedArtId) ?? loadingArtRegistry[0],
    [selectedArtId],
  );

  const handleCycle = () => {
    if (loadingArtRegistry.length === 0) return;

    const currentIndex = loadingArtRegistry.findIndex((art) => art.id === selectedArt?.id);
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % loadingArtRegistry.length
      : 0;

    setSelectedArtId(loadingArtRegistry[nextIndex].id);
  };

  return (
    <>
      <ShellPageHeader>
        <div className="px-4 h-full flex items-center relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <h1 className="text-[13px] font-medium text-text-primary truncate">Art Lab</h1>
          </div>
        </div>
      </ShellPageHeader>

      <div className="flex-1 p-2 pt-0 pl-1 min-h-0">
        <main className="h-full bg-surface rounded-lg shadow-workspace min-h-0 overflow-hidden">
          {!showArtLab ? (
            <div className="h-full flex items-center justify-center px-6">
              <div className="max-w-md text-center space-y-4">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-text-primary">Developer mode required</h2>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    This hidden page is only meant for internal art lab experiments. Turn on
                    Developer Mode in Settings to use it.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => router.push('/')}
                    className="btn-secondary"
                  >
                    Back to home
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-0 px-6 py-6">
              <div className="flex h-full min-h-0 w-full gap-6">
                <div className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-surface">
                  <div className="flex min-h-full flex-col items-center justify-center gap-8 py-8">
                    {selectedArt ? (
                      <LoadingArtHost
                        artId={selectedArt.id}
                        size={360}
                      />
                    ) : null}

                    <div className="flex flex-col items-center gap-3">
                      {selectedArt ? (
                        <p className="text-sm font-medium text-text-primary">
                          {selectedArt.name}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleCycle}
                        className="btn-primary !px-5 !py-2"
                      >
                        Cycle art
                      </button>
                    </div>
                  </div>
                </div>

                <aside className="w-[18rem] shrink-0 self-start">
                  <div className="flex flex-col rounded-lg border border-divider bg-surface-subtle/40 p-5">
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
                        Registry
                      </p>
                    </div>

                    <div className="mt-4 space-y-2">
                      {loadingArtRegistry.map((art) => {
                        const active = art.id === selectedArt?.id;

                        return (
                          <button
                            key={art.id}
                            type="button"
                            onClick={() => setSelectedArtId(art.id)}
                            className={`btn-secondary w-full !items-start !justify-start !rounded-lg !px-4 !py-3 text-left ${
                              active ? '!border-accent !text-accent' : ''
                            }`}
                          >
                            <span className="flex flex-col items-start gap-1">
                              <span className="text-sm font-medium">{art.name}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

export default function LoadingArtLabPage() {
  return (
    <ProtectedRoute>
      <LoadingArtLabContent />
    </ProtectedRoute>
  );
}
