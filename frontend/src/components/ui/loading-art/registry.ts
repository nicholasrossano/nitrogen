import { CherryBlossomLoadingArt } from './CherryBlossomLoadingArt';
import { DandelionLoadingArt } from './DandelionLoadingArt';
import { FernLoadingArt } from './FernLoadingArt';
import { DahliaLoadingArt } from './DahliaLoadingArt';
import { OakLoadingArt } from './OakLoadingArt';
import { PineLoadingArt } from './PineLoadingArt';
import { SunflowerLoadingArt } from './SunflowerLoadingArt';
import type { LoadingArtDefinition } from './types';

export const loadingArtRegistry: LoadingArtDefinition[] = [
  {
    id: 'acacia',
    name: 'Acacia',
    enabled: false,
    description: 'An umbrella acacia silhouette with a branching crown that compresses toward the trunk on inhale and opens back out on exhale.',
    Component: CherryBlossomLoadingArt,
  },
  {
    id: 'dahlia',
    name: 'Dahlia',
    enabled: false,
    description: 'Seven concentric rings of petals bloom open from a tight bud and close again on each breath.',
    Component: DahliaLoadingArt,
  },
  {
    id: 'dandelion',
    name: 'Dandelion',
    enabled: false,
    description: 'An airy dandelion seed globe sheds a windblown veil of drifting spores before gathering again.',
    Component: DandelionLoadingArt,
  },
  {
    id: 'fern',
    name: 'Fern',
    enabled: true,
    description: 'Barnsley fern fronds fold toward the central spine on each inhale, then reopen to the full fractal leaf.',
    Component: FernLoadingArt,
  },
  {
    id: 'oak',
    name: 'Oak',
    enabled: false,
    description: 'A broad oak canopy gathers toward its trunk-and-branch scaffold on each inhale, then billows back into a lobed crown.',
    Component: OakLoadingArt,
  },
  {
    id: 'pine',
    name: 'Pine',
    enabled: false,
    description: 'Dense needle-tuft rosette radiating from a glowing core with soft harmonic breath.',
    Component: PineLoadingArt,
  },
  {
    id: 'sunflower',
    name: 'Sunflower',
    enabled: false,
    description: 'Fermat/phyllotaxis spiral disk of seeds surrounded by 21 tapered petals — closes to the disk edge on each breath and blooms back open.',
    Component: SunflowerLoadingArt,
  },
];

export function getLoadingArtById(id?: string | null): LoadingArtDefinition | undefined {
  if (!id) return undefined;
  return loadingArtRegistry.find((art) => art.id === id);
}

export function getRandomLoadingArt(excludeId?: string | null): LoadingArtDefinition {
  const enabledArt = loadingArtRegistry.filter((art) => art.enabled);
  const basePool = enabledArt.length > 0 ? enabledArt : loadingArtRegistry;
  const availableArt = excludeId
    ? basePool.filter((art) => art.id !== excludeId)
    : basePool;

  const selectionPool = availableArt.length > 0 ? availableArt : basePool;
  return selectionPool[Math.floor(Math.random() * selectionPool.length)];
}
