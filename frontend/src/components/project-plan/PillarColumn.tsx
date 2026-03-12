'use client';

import { useState } from 'react';
import {
  Shield, Scale, Lock, FileText, BookOpen, Flag,
  Banknote, DollarSign, PiggyBank, TrendingUp, Coins, Wallet, CircleDollarSign,
  Compass, Wrench, Hammer, Settings, Target, Rocket,
  Leaf, TreePine, Sprout, Recycle, Waves, CloudRain, Mountain,
  Zap, Sun, Battery, BatteryCharging, Plug, Wind,
  Users, Handshake, HeartHandshake, Globe, MapPin, Map, Navigation,
  BarChart3, Database, Network, Satellite, Award, CheckCircle,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DeepDiveResult, ProjectPlanItem, ProjectPlanPillar } from '@/lib/api';
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

export function PillarColumn({ pillar, deepDiveCache = {}, onDeepDive, onDeleteItem, onDeleteElement, onRegisterRef, completedIds, onToggleComplete, color = '#005e72' }: PillarColumnProps) {
  const [showAll, setShowAll] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const CLASSIFICATION_ORDER: Record<string, number> = { required: 0, optional: 1, unknown: 2 };
  const items = (pillar.items || []).slice().sort((a, b) => {
    const aOrder = CLASSIFICATION_ORDER[a.classification ?? 'optional'] ?? 1;
    const bOrder = CLASSIFICATION_ORDER[b.classification ?? 'optional'] ?? 1;
    return aOrder - bOrder;
  });
  const visibleItems = showAll ? items : items.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = items.length - DEFAULT_VISIBLE;
  const requiredCount = items.filter(i => i.classification === 'required').length;
  const unknownCount = items.filter(i => i.classification === 'unknown').length;
  const optionalCount = items.length - requiredCount - unknownCount;

  return (
    <div className="flex flex-col min-h-0" ref={el => onRegisterRef?.(el)}>
      {/* Pillar header node — full width, aligned with items */}
      <button
        onClick={() => setItemsExpanded(v => !v)}
        className="border bg-surface rounded-md px-4 py-3 flex items-center gap-2.5 w-full text-left transition-colors duration-150"
        style={{ borderColor: color }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = hexToRgba(color, 0.06); }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = ''; }}
      >
        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: hexToRgba(color, 0.1), color }}>
          <PillarIcon name={pillar.icon} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-text-primary leading-tight whitespace-nowrap">
            {pillar.name}
          </h3>
          <p className="text-[11px] text-text-tertiary mt-0.5 whitespace-nowrap">
            {requiredCount} required &middot; {optionalCount} optional
            {unknownCount > 0 && <> &middot; <span className="text-indicator-orange">{unknownCount} unknown</span></>}
          </p>
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
            isLast={idx === visibleItems.length - 1 && (showAll || hiddenCount <= 0)}
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
      </div>}
    </div>
  );
}
