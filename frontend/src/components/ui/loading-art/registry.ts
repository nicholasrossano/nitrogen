import { DandelionLoadingArt } from './DandelionLoadingArt';
import { FernLoadingArt } from './FernLoadingArt';
import { DahliaLoadingArt } from './DahliaLoadingArt';
import { PineLoadingArt } from './PineLoadingArt';
import { WisteriaLoadingArt } from './WisteriaLoadingArt';
import type { LoadingArtDefinition } from './types';

export const loadingArtRegistry: LoadingArtDefinition[] = [
  {
    id: 'dandelion',
    name: 'Dandelion',
    description: 'An airy dandelion seed globe sheds a windblown veil of drifting spores before gathering again.',
    Component: DandelionLoadingArt,
  },
  {
    id: 'fern',
    name: 'Fern',
    description: 'Barnsley fern fronds fold toward the central spine on each inhale, then reopen to the full fractal leaf.',
    Component: FernLoadingArt,
  },
  {
    id: 'dahlia',
    name: 'Dahlia',
    description: 'Seven concentric rings of petals bloom open from a tight bud and close again on each breath.',
    Component: DahliaLoadingArt,
  },
  {
    id: 'pine',
    name: 'Pine',
    description: 'Dense needle-tuft rosette radiating from a glowing core with soft harmonic breath.',
    Component: PineLoadingArt,
  },
  {
    id: 'wisteria',
    name: 'Wisteria',
    description: 'A wisteria raceme — wide at the top, tapering to a point — cinches inward on each breath and blooms back open.',
    Component: WisteriaLoadingArt,
  },
];

export function getLoadingArtById(id?: string | null): LoadingArtDefinition | undefined {
  if (!id) return undefined;
  return loadingArtRegistry.find((art) => art.id === id);
}

export function getRandomLoadingArt(excludeId?: string | null): LoadingArtDefinition {
  const availableArt = excludeId
    ? loadingArtRegistry.filter((art) => art.id !== excludeId)
    : loadingArtRegistry;

  const selectionPool = availableArt.length > 0 ? availableArt : loadingArtRegistry;
  return selectionPool[Math.floor(Math.random() * selectionPool.length)];
}
