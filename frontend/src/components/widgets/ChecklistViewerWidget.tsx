'use client';

import { useState } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  ChevronRight, 
  AlertTriangle, 
  CheckCircle, 
  Circle, 
  Download, 
  Loader2 
} from 'lucide-react';
import { api } from '@/lib/api';

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
  data: {
    content: {
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
    };
    tool_name?: string;
  };
  initiativeId: string;
  isActive?: boolean;
}

function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const colors = {
    low: 'bg-forest/15 text-forest',
    medium: 'bg-rust/15 text-rust',
    high: 'bg-merlot/15 text-merlot',
  };
  
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[level]}`}>
      {level}
    </span>
  );
}

function CategorySection({ category, defaultOpen = false }: { category: ChecklistCategory; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border border-beige/50 rounded-card overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-blush/30 hover:bg-blush/50 transition-colors text-left"
      >
        <div>
          <h4 className="font-semibold text-brown">{category.name}</h4>
          <p className="text-xs text-brown/60">{category.description}</p>
        </div>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-brown/50" />
        ) : (
          <ChevronRight className="w-5 h-5 text-brown/50" />
        )}
      </button>
      
      {isOpen && (
        <div className="p-4 space-y-3 bg-cream">
          {category.items.map((item, idx) => (
            <div key={idx} className="flex gap-3">
              <Circle className="w-4 h-4 text-beige mt-1 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-brown font-medium">{item.item}</p>
                  <RiskBadge level={item.risk_level} />
                </div>
                {item.questions && item.questions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {item.questions.map((q, qIdx) => (
                      <li key={qIdx} className="text-xs text-brown/60 pl-2 border-l-2 border-beige">
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

export function ChecklistViewerWidget({ data, initiativeId, isActive = true }: ChecklistViewerWidgetProps) {
  const content = data.content;
  const [expanded, setExpanded] = useState(true);
  const [exporting, setExporting] = useState(false);
  
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
        <p className="text-brown/60">Checklist content not available</p>
      </div>
    );
  }
  
  return (
    <div className="card-elevated overflow-hidden">
      {/* Header - matches memo viewer style */}
      <div className="px-5 py-4 bg-gradient-to-r from-forest/10 to-teal/10 border-b border-beige/50 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-brown">{content.title}</h3>
          <p className="text-sm text-brown/60">{content.date}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-2.5 hover:bg-forest/10 rounded-pill transition-all duration-200"
        >
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-forest" />
          ) : (
            <ChevronDown className="w-5 h-5 text-forest" />
          )}
        </button>
      </div>

      {expanded && (
        <>
          {/* Content */}
          <div className="p-6 space-y-6 max-h-[500px] overflow-y-auto bg-cream">
            {/* Priority Items */}
            {content.priority_items && content.priority_items.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-brown mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rust" />
                  Priority Items
                </h2>
                <ul className="space-y-2">
                  {content.priority_items.map((item, idx) => (
                    <li key={idx} className="text-sm text-brown/80 flex items-start gap-2">
                      <span className="text-rust font-bold">{idx + 1}.</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            
            {/* Categories */}
            <section>
              <h2 className="text-lg font-semibold text-brown mb-3">Checklist Categories</h2>
              <div className="space-y-3">
                {content.categories.map((category, idx) => (
                  <CategorySection key={idx} category={category} defaultOpen={idx === 0} />
                ))}
              </div>
            </section>
            
            {/* Next Steps */}
            {content.next_steps && content.next_steps.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-brown mb-3 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-forest" />
                  Recommended Next Steps
                </h2>
                <ol className="space-y-2 list-decimal list-inside">
                  {content.next_steps.map((step, idx) => (
                    <li key={idx} className="text-sm text-brown/80">{step}</li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          {/* Actions - matches memo viewer style */}
          <div className="px-5 py-4 bg-blush/50 border-t border-beige/50">
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
        </>
      )}
    </div>
  );
}
