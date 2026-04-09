'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Loader2, Check } from 'lucide-react';
import type { WorkflowBuild, BuildLayerDef, BuildStage as BuildStageData, BuildItem } from '@/lib/api';
import { api } from '@/lib/api';
import { SimpleListView } from './views/SimpleListView';
import { StructuredListView } from './views/StructuredListView';
import { FloatingCard } from './FloatingCard';

function getStageById(build: WorkflowBuild, stageId: string): BuildStageData | undefined {
  return build.stages?.find((s) => s.id === stageId);
}

function StageButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="btn-primary !text-xs !px-4 !py-1.5"
      style={{ width: '40%' }}
    >
      {label}
    </button>
  );
}

function GeneratingPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-text-tertiary">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-xs">Generating {label}…</span>
    </div>
  );
}

interface BuildStageProps {
  instanceId: string;
  build: WorkflowBuild;
  layerDefs: BuildLayerDef[];
  /** When true, suppress all editing/confirming — user is just viewing the traceback */
  readOnly?: boolean;
  onStateUpdated: () => void;
  onProceedToOutput?: () => void;
  onAddToChat?: (item: BuildItem) => void;
}

export function BuildStage({
  instanceId,
  build,
  layerDefs,
  readOnly = false,
  onStateUpdated,
  onProceedToOutput,
  onAddToChat,
}: BuildStageProps) {
  const outlineDef = layerDefs[0]; // "Outline"
  const detailsDef = layerDefs[1]; // "Details"

  const [unlockedLayers, setUnlockedLayers] = useState<Set<string>>(() => {
    const s = new Set<string>();
    layerDefs.forEach((layer, idx) => {
      if (idx === 0) s.add(layer.id);
      else if ((getStageById(build, layer.id)?.items?.length ?? 0) > 0) s.add(layer.id);
    });
    return s;
  });

  const [activeLayerId, setActiveLayerId] = useState<string>(() => {
    // Start on the last layer that has items, or the first layer
    for (let i = layerDefs.length - 1; i >= 0; i--) {
      if ((getStageById(build, layerDefs[i].id)?.items?.length ?? 0) > 0) {
        return layerDefs[i].id;
      }
    }
    return build.current_stage_id ?? layerDefs[0]?.id ?? '';
  });

  const [generatingLayer, setGeneratingLayer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoGenTriggered = useRef<Set<string>>(new Set());

  // Derive confirmed categories from existing item data so they survive tab switches.
  // Any outline category that has ≥1 item in the Details layer is considered confirmed.
  const [confirmedCategories, setConfirmedCategories] = useState<Set<string>>(() => {
    const confirmed = new Set<string>();
    const detailItems = getStageById(build, layerDefs[1]?.id ?? '')?.items ?? [];
    if (detailItems.length > 0) {
      detailItems.forEach((item) => {
        const parent = item.content.parent as string;
        if (parent) confirmed.add(parent);
      });
    }
    return confirmed;
  });

  const runGenerate = useCallback(async (layerId: string) => {
    setGeneratingLayer(layerId);
    setError(null);
    try {
      await api.generateBuildLayer(instanceId, layerId);
      onStateUpdated();
    } catch (e: any) {
      setError(e.message ?? 'Generation failed');
    } finally {
      setGeneratingLayer(null);
    }
  }, [instanceId, onStateUpdated]);

  // Snap active tab if it becomes inaccessible
  useEffect(() => {
    if (!layerDefs.length) return;
    if (!unlockedLayers.has(activeLayerId)) {
      const first = layerDefs.find((l) => unlockedLayers.has(l.id));
      if (first) setActiveLayerId(first.id);
    }
  }, [layerDefs, unlockedLayers, activeLayerId]);

  // Auto-generate any unlocked layer that has no items yet (skip in read-only mode)
  useEffect(() => {
    if (readOnly) return;
    unlockedLayers.forEach((layerId) => {
      if (autoGenTriggered.current.has(layerId)) return;
      const stage = getStageById(build, layerId);
      const isEmpty = !stage?.items?.length;
      const isPending = !stage?.status || stage.status === 'pending';
      if (isEmpty && isPending) {
        autoGenTriggered.current.add(layerId);
        runGenerate(layerId);
      }
    });
  }, [readOnly, unlockedLayers, build.stages, runGenerate]);

  const unlockDetails = () => {
    if (!detailsDef) return;
    setUnlockedLayers((prev) => new Set([...prev, detailsDef.id]));
    setActiveLayerId(detailsDef.id);
  };

  const handleDelete = async (layerId: string, itemId: string) => {
    try {
      await api.deleteBuildItem(instanceId, layerId, itemId);
      onStateUpdated();
    } catch (e: any) {
      setError(e.message ?? 'Failed to delete item');
    }
  };

  const handleReorder = (layerId: string, newItemIds: string[]) => {
    api.reorderBuildItems(instanceId, layerId, newItemIds).catch(() => {});
  };

  const handleCategoryReorder = useCallback(
    (categoryName: string, newCategoryItemIds: string[]) => {
      if (!detailsDef) return;
      const allItems = getStageById(build, detailsDef.id)?.items ?? [];
      const catOrder = (getStageById(build, outlineDef?.id ?? '')?.items ?? []).map(
        (i) => i.content.title as string
      );

      const byCategory = new Map<string, BuildItem[]>();
      allItems.forEach((item) => {
        const cat = (item.content.parent as string) ?? '';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(item);
      });

      const newCatItems = newCategoryItemIds
        .map((id) => allItems.find((i) => i.id === id))
        .filter((i): i is BuildItem => Boolean(i));
      byCategory.set(categoryName, newCatItems);

      const newFullOrder = catOrder.flatMap((cat) => byCategory.get(cat) ?? []);
      const knownIds = new Set(newFullOrder.map((i) => i.id));
      const extras = allItems.filter((i) => !knownIds.has(i.id));

      api
        .reorderBuildItems(instanceId, detailsDef.id, [
          ...newFullOrder,
          ...extras,
        ].map((i) => i.id))
        .catch(() => {});
    },
    [build.layers, instanceId, outlineDef, detailsDef]
  );

  const outlineItems = getStageById(build, outlineDef?.id ?? '')?.items ?? [];
  const detailsItems = getStageById(build, detailsDef?.id ?? '')?.items ?? [];

  const isGenerating = (id: string) =>
    generatingLayer === id || getStageById(build, id)?.status === 'generating';

  const detailsUnlocked = detailsDef ? unlockedLayers.has(detailsDef.id) : false;

  const categories = outlineItems.map((i) => i.content.title as string);
  const itemsByCategory = new Map<string, BuildItem[]>();
  categories.forEach((cat) => itemsByCategory.set(cat, []));
  detailsItems.forEach((item) => {
    const cat = (item.content.parent as string) ?? '';
    if (itemsByCategory.has(cat)) {
      itemsByCategory.get(cat)!.push(item);
    } else {
      if (!itemsByCategory.has('Other')) itemsByCategory.set('Other', []);
      itemsByCategory.get('Other')!.push(item);
    }
  });

  const allCategoriesConfirmed =
    categories.length > 0 && categories.every((c) => confirmedCategories.has(c));

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Layer tabs */}
      <div className="flex justify-center items-center gap-1 px-3 pt-3 pb-0 border-b border-stroke-subtle shrink-0">
        {layerDefs.map((layer) => {
          const accessible = unlockedLayers.has(layer.id);
          const isActive = layer.id === activeLayerId;
          return (
            <button
              key={layer.id}
              type="button"
              onClick={() => accessible && setActiveLayerId(layer.id)}
              disabled={!accessible}
              className={`px-4 py-2 text-xs font-medium rounded-t border-b-2 transition-colors ${
                isActive
                  ? 'border-accent text-accent bg-accent/5'
                  : accessible
                  ? 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-subtle'
                  : 'border-transparent text-text-tertiary cursor-not-allowed opacity-40'
              }`}
            >
              {layer.name}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-3">
        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2 mb-3 flex items-center justify-between">
            <span>{error}</span>
            <button type="button" className="underline ml-2" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* ── Outline tab ── */}
        {activeLayerId === outlineDef?.id && outlineDef && (
          <FloatingCard
            title={outlineDef.name}
            footer={
              !readOnly && !isGenerating(outlineDef.id) && outlineItems.length > 0 && !detailsUnlocked
                ? <StageButton label="Next" onClick={unlockDetails} />
                : undefined
            }
          >
            {isGenerating(outlineDef.id) ? (
              <GeneratingPlaceholder label={outlineDef.name} />
            ) : outlineItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-tertiary">
                No items generated.{' '}
                {!readOnly && (
                  <button type="button" className="underline" onClick={() => runGenerate(outlineDef.id)}>
                    Try again
                  </button>
                )}
              </div>
            ) : (
              <SimpleListView
                items={outlineItems}
                onDelete={readOnly ? undefined : (id) => handleDelete(outlineDef.id, id)}
                onReorder={readOnly ? undefined : (ids) => handleReorder(outlineDef.id, ids)}
                onAddToChat={onAddToChat}
              />
            )}
          </FloatingCard>
        )}

        {/* ── Details tab: one card per Outline category ── */}
        {activeLayerId === detailsDef?.id && detailsUnlocked && detailsDef && (
          <>
            {isGenerating(detailsDef.id) ? (
              <FloatingCard title={detailsDef.name}>
                <GeneratingPlaceholder label={detailsDef.name} />
              </FloatingCard>
            ) : (
              <>
                {[...itemsByCategory.entries()].map(([cat, catItems]) => {
                  const isConfirmed = readOnly || confirmedCategories.has(cat);
                  return (
                    <FloatingCard
                      key={cat}
                      title={cat}
                      footer={
                        isConfirmed ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-green-500 font-medium">
                            <Check className="w-3 h-3" /> Confirmed
                          </span>
                        ) : (
                          <StageButton
                            label="Confirm"
                            onClick={() =>
                              setConfirmedCategories((prev) => new Set([...prev, cat]))
                            }
                            disabled={catItems.length === 0}
                          />
                        )
                      }
                    >
                      {catItems.length === 0 ? (
                        <div className="py-4 text-center text-xs text-text-tertiary">No items.</div>
                      ) : (
                        <StructuredListView
                          items={catItems}
                          onDelete={
                            isConfirmed ? undefined : (id) => handleDelete(detailsDef.id, id)
                          }
                          onReorder={
                            isConfirmed ? undefined : (ids) => handleCategoryReorder(cat, ids)
                          }
                          onAddToChat={onAddToChat}
                        />
                      )}
                    </FloatingCard>
                  );
                })}

                {!readOnly && allCategoriesConfirmed && (
                  <div className="flex justify-center py-2">
                    <StageButton
                      label="Generate Output"
                      onClick={() => onProceedToOutput?.()}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
