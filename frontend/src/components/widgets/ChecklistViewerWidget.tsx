'use client';

import { useState } from 'react';
import { 
  ChevronDown, 
  ChevronRight, 
  AlertTriangle, 
  CheckCircle, 
  CheckSquare,
  Circle, 
  Download, 
  Loader2 
} from 'lucide-react';
import { api } from '@/lib/api';
import { useInitiativeStore } from '@/stores/initiativeStore';

interface ChecklistItem {
  item: string;
  questions: string[];
  risk_level: 'low' | 'medium' | 'high';
}

interface ChecklistCategory {
  name: string;
  description: string;
  items: ChecklistItem[];
}

interface ChecklistViewerWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const colors = {
    low: 'bg-indicator-green/10 text-indicator-green',
    medium: 'bg-indicator-yellow/10 text-indicator-yellow',
    high: 'bg-indicator-orange/10 text-indicator-orange',
  };
  
  return (
    <span className={`text-sm px-2 py-0.5 rounded-sm font-medium ${colors[level]}`}>
      {level}
    </span>
  );
}

function CategorySection({ category, defaultOpen = false }: { category: ChecklistCategory; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border border-stroke-subtle rounded overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="expandable-header bg-surface-header"
      >
        <div>
          <h4 className="text-sm font-semibold text-text-primary">{category.name}</h4>
          <p className="text-sm text-text-secondary">{category.description}</p>
        </div>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-text-tertiary" />
        ) : (
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        )}
      </button>
      
      {isOpen && (
        <div className="p-4 space-y-3 bg-white">
          {category.items.map((item, idx) => (
            <div key={idx} className="flex gap-3">
              <Circle className="w-4 h-4 text-divider mt-1 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-text-primary">{item.item}</p>
                  <RiskBadge level={item.risk_level} />
                </div>
                {item.questions && item.questions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {item.questions.map((q, qIdx) => (
                      <li key={qIdx} className="text-xs text-text-secondary pl-2 border-l border-divider">
                        {q}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatHeaderDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface ChecklistContent {
  title: string;
  date: string;
  project_summary: {
    title: string;
    type: string;
    geography: string;
    stage: string;
  };
  categories: ChecklistCategory[];
  overall_risk_rating: 'low' | 'medium' | 'high';
  priority_items: string[];
  next_steps: string[];
}

export function ChecklistViewerWidget({ data, initiativeId, isActive = true }: ChecklistViewerWidgetProps) {
  const initiative = useInitiativeStore((s) => s.initiative);
  const content = data.content as ChecklistContent | undefined;
  const [exporting, setExporting] = useState(false);
  const projectName =
    initiative?.title ??
    (content?.title?.includes(': ') ? content.title.split(': ').slice(1).join(': ') : undefined) ??
    'Project';
  
  const handleExport = async () => {
    setExporting(true);
    try {
      await api.exportChecklist(initiativeId, content);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(false);
    }
  };
  
  if (!content || !content.categories) {
    return (
      <div className="card-elevated p-6">
        <p className="text-text-secondary">Checklist content not available</p>
      </div>
    );
  }
  
  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 bg-surface-header border-b border-divider flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent-wash rounded flex items-center justify-center flex-shrink-0">
            <CheckSquare className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Due Diligence Checklist</h3>
            <p className="text-sm text-text-secondary mt-0.5">{projectName}</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary whitespace-nowrap self-start">{formatHeaderDate(content.date)}</p>
      </div>

      {/* Content */}
          <div className="p-6 space-y-6 max-h-[500px] overflow-y-auto bg-white">
            {/* Priority Items */}
            {content.priority_items && content.priority_items.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-indicator-orange" />
                  Priority Items
                </h2>
                <ul className="space-y-2">
                  {content.priority_items.map((item, idx) => (
                    <li key={idx} className="text-sm text-text-secondary flex items-start gap-2">
                      <span className="text-indicator-orange font-bold">{idx + 1}.</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            
            {/* Categories */}
            <section>
              <h2 className="text-sm font-semibold text-text-primary mb-3">Checklist Categories</h2>
              <div className="space-y-3">
                {content.categories.map((category, idx) => (
                  <CategorySection key={idx} category={category} defaultOpen={idx === 0} />
                ))}
              </div>
            </section>
            
            {/* Next Steps */}
            {content.next_steps && content.next_steps.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-indicator-green" />
                  Recommended Next Steps
                </h2>
                <ol className="space-y-2 list-decimal list-inside">
                  {content.next_steps.map((step, idx) => (
                    <li key={idx} className="text-sm text-text-secondary">{step}</li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          {/* Actions */}
          <div className="px-5 py-4 bg-surface-header border-t border-divider">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="btn-primary w-full"
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export to Excel
                </>
              )}
            </button>
          </div>
    </div>
  );
}
