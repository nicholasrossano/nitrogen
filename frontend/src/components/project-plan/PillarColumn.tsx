'use client';

import { useRef, useState } from 'react';
import {
  Shield, Scale, Lock, FileText, BookOpen, Flag,
  Banknote, DollarSign, PiggyBank, TrendingUp, Coins, Wallet, CircleDollarSign,
  Compass, Wrench, Hammer, Settings, Target, Rocket,
  Leaf, TreePine, Sprout, Recycle, Waves, CloudRain, Mountain,
  Zap, Sun, Battery, BatteryCharging, Plug, Wind,
  Users, Handshake, HeartHandshake, Globe, MapPin, Map, Navigation,
  BarChart3, Database, Network, Satellite, Award, CheckCircle,
  ChevronDown, ChevronRight, Plus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DeepDiveResult, ProjectPlanItem, ProjectPlanPhase, ProjectPlanPillar } from '@/lib/api';
import { DIAGRAM_ACCENT_COLOR } from '@/lib/diagramAccent';
import { PlanSubItem } from './PlanSubItem';

interface PillarColumnProps {
  pillar: ProjectPlanPillar;
  deepDiveCache?: Record<string, DeepDiveResult>;
  onDeepDive?: (item: ProjectPlanItem, pillar: ProjectPlanPillar) => void;
  onDeleteItem?: (itemId: string) => void;
  onDeleteElement?: (itemId: string, elementIndex: number) => void;
  onRegisterRef?: (el: HTMLDivElement | null) => void;
  completedIds?: Set<string>;
  onToggleComplete?: (id: string) => void;
  color?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  phases?: ProjectPlanPhase[];
  onAddItem?: (pillarId: string, title: string, phaseId?: string) => Promise<void>;
}

const ICON_MAP: Record<string, LucideIcon> = {
  Shield, Scale, Lock, FileText, BookOpen, Flag,
  Banknote, DollarSign, PiggyBank, TrendingUp, Coins, Wallet, CircleDollarSign,
  Compass, Wrench, Hammer, Settings, Target, Rocket,
  Leaf, TreePine, Sprout, Recycle, Waves, CloudRain, Mountain,
  Zap, Sun, Battery, BatteryCharging, Plug, Wind,
  Users, Handshake, HeartHandshake, Globe, MapPin, Map, Navigation,
  BarChart3, Database, Network, Satellite, Award, CheckCircle,
};

function PillarIcon({ name }: { name?: string }) {
  const Icon = (name && ICON_MAP[name]) || Compass;
  return <Icon className="w-5 h-5" />;
}

const DEFAULT_VISIBLE = 10;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Dotted line style — same colour as solid branch lines but dashed
const DOTTED_LINE_STYLE = {
  backgroundImage: 'repeating-linear-gradient(to bottom, #C8C4BE 0px, #C8C4BE 3px, transparent 3px, transparent 7px)',
} as const;
const DOTTED_LINE_H_STYLE = {
  backgroundImage: 'repeating-linear-gradient(to right, #C8C4BE 0px, #C8C4BE 3px, transparent 3px, transparent 7px)',
} as const;

export function PillarColumn({ pillar, deepDiveCache = {}, onDeepDive, onDeleteItem, onDeleteElement, onRegisterRef, completedIds, onToggleComplete, color = DIAGRAM_ACCENT_COLOR, expanded: expandedProp, onToggleExpanded, onAddItem, phases }: PillarColumnProps) {
  const [showAll, setShowAll] = useState(false);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [addingSaving, setAddingSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const itemsExpanded = expandedProp !== undefined ? expandedProp : internalExpanded;
  const toggleExpanded = onToggleExpanded ?? (() => setInternalExpanded(v => !v));
  const CLASSIFICATION_ORDER: Record<string, number> = { required: 0, optional: 1, unknown: 2 };
  const items = (pillar.items || []).slice().sort((a, b) => {
    const aOrder = CLASSIFICATION_ORDER[a.classification ?? 'optional'] ?? 1;
    const bOrder = CLASSIFICATION_ORDER[b.classification ?? 'optional'] ?? 1;
    return aOrder - bOrder;
  });
  const visibleItems = showAll ? items : items.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = items.length - DEFAULT_VISIBLE;

  const handleStartAdding = () => {
    setIsAdding(true);
    setNewItemTitle('');
    setSelectedPhaseId(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleCancelAdding = () => {
    setIsAdding(false);
    setNewItemTitle('');
    setSelectedPhaseId(null);
  };

  const handleCommitItem = async () => {
    const title = newItemTitle.trim();
    if (!title || !onAddItem || addingSaving) return;
    setAddingSaving(true);
    try {
      await onAddItem(pillar.id, title, selectedPhaseId ?? undefined);
    } finally {
      setAddingSaving(false);
      setIsAdding(false);
      setNewItemTitle('');
      setSelectedPhaseId(null);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommitItem();
    } else if (e.key === 'Escape') {
      handleCancelAdding();
    }
  };

  return (
    <div className="flex flex-col min-h-0" ref={el => onRegisterRef?.(el)}>
      {/* Pillar header node — full width, aligned with items */}
      <button
        onClick={() => toggleExpanded()}
        className="border bg-surface rounded-md px-4 py-3 flex items-center gap-2.5 w-full text-left transition-colors duration-150"
        style={{ borderColor: color }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = hexToRgba(color, 0.06); }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
      >
        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: hexToRgba(color, 0.1), color }}>
          <PillarIcon name={pillar.icon} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary leading-tight truncate">
            {pillar.name}
          </h3>
        </div>
        {itemsExpanded
          ? <ChevronDown className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />}
      </button>

      {/* Items — branch line connects from header's left edge */}
      {itemsExpanded && <div className="flex-1 overflow-y-auto min-h-0">
        {visibleItems.map((item, idx) => (
          <PlanSubItem
            key={item.id}
            item={item}
            isLast={idx === visibleItems.length - 1 && (showAll || hiddenCount <= 0) && !isAdding}
            deepDiveResult={deepDiveCache[item.id] ?? null}
            onDeepDive={onDeepDive ? (item) => onDeepDive(item, pillar) : undefined}
            onDelete={onDeleteItem ? () => onDeleteItem(item.id) : undefined}
            onDeleteElement={onDeleteElement ? (elIdx) => onDeleteElement(item.id, elIdx) : undefined}
            isComplete={completedIds?.has(item.id) ?? false}
            onToggleComplete={onToggleComplete}
          />
        ))}

        {!showAll && hiddenCount > 0 && (
          <div className="flex items-stretch">
            <div className="w-8 flex flex-col items-center flex-shrink-0">
              <div className="w-px bg-stroke-subtle flex-1" />
            </div>
            <div className="flex-1 py-1.5 pl-2">
              <button
                onClick={() => setShowAll(true)}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors flex items-center gap-1"
              >
                <ChevronDown className="w-3 h-3" />
                {hiddenCount} more
              </button>
            </div>
          </div>
        )}
        {showAll && hiddenCount > 0 && (
          <div className="flex items-stretch">
            <div className="w-8 flex-shrink-0" />
            <div className="flex-1 py-1.5 pl-2">
              <button
                onClick={() => setShowAll(false)}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                Show less
              </button>
            </div>
          </div>
        )}

        {/* Add-item area — always shown at bottom when pillar is expanded and onAddItem is provided */}
        {onAddItem && (
          isAdding ? (
            /* Input node with dotted branch line */
            <div className="flex items-stretch relative">
              <div className="w-8 flex-shrink-0 relative">
                {/* Dotted vertical line from top to midpoint */}
                <div className="absolute left-1/2 top-0 w-px" style={{ height: '50%', ...DOTTED_LINE_STYLE }} />
                {/* Dotted horizontal line from midpoint to right edge */}
                <div className="absolute top-1/2 left-1/2 right-0 h-px -translate-y-1/2" style={DOTTED_LINE_H_STYLE} />
                {/* Green dot at intersection */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-green-500 z-10" />
              </div>
              <div className="flex-1 min-w-0 py-1.5 pr-2">
                <div className={`px-3 py-2 rounded-md shadow-card border border-green-400/50 bg-surface flex gap-2 ${phases && phases.length > 0 ? 'flex-col' : 'items-center'}`}>
                  <input
                    ref={inputRef}
                    value={newItemTitle}
                    onChange={(e) => setNewItemTitle(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={() => { if (!newItemTitle.trim()) handleCancelAdding(); }}
                    placeholder="New item title…"
                    disabled={addingSaving}
                    className="flex-1 text-sm font-medium bg-transparent outline-none text-text-primary placeholder:text-text-tertiary disabled:opacity-50"
                  />
                  {/* Phase selector — only shown when phases exist */}
                  {phases && phases.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {phases.map((ph, i) => {
                        const selected = selectedPhaseId === ph.id;
                        return (
                          <button
                            key={ph.id}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); setSelectedPhaseId(selected ? null : ph.id); }}
                            className={`text-[9px] font-medium px-1.5 py-0.5 rounded transition-all ${selected ? 'bg-accent/15 text-accent ring-1 ring-accent/40 ring-offset-1 opacity-100' : 'bg-surface-subtle text-text-tertiary opacity-60 hover:opacity-90'}`}
                          >
                            {i + 1}. {ph.name}
                          </button>
                        );
                      })}
                      {addingSaving && (
                        <div className="w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full animate-spin ml-1" />
                      )}
                    </div>
                  )}
                  {(!phases || phases.length === 0) && addingSaving && (
                    <div className="w-3.5 h-3.5 border-2 border-green-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  )}
                </div>
                <p className="text-[10px] text-text-tertiary mt-1 pl-1">Enter to save · Esc to cancel</p>
              </div>
            </div>
          ) : (
            /* Plus button — centered under the full pillar card, no branch lines */
            <div className="flex justify-center py-2">
              <button
                onClick={handleStartAdding}
                className="w-4 h-4 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center transition-colors duration-150 shadow-sm"
                aria-label="Add item"
              >
                <Plus className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
              </button>
            </div>
          )
        )}
      </div>}
    </div>
  );
}
