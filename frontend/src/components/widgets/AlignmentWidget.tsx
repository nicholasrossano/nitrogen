'use client';

import { useState } from 'react';
import { useInitiativeStore } from '@/stores/initiativeStore';
import { 
  Check, 
  Loader2, 
  ChevronDown, 
  ChevronRight,
  MessageSquare,
  Pencil,
  AlertCircle,
  ListChecks,
} from 'lucide-react';
import { getIconByName } from '@/lib/icons';
import type { AlignmentSection, AlignmentParameter, ToolAlignment } from '@/lib/api';

interface ToolInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  output_type: string;
}

interface AlignmentWidgetProps {
  data: {
    alignment: ToolAlignment;
    tool: ToolInfo;
    pending_tools: ToolInfo[];
  };
  initiativeId: string;
  isActive?: boolean;
}

export function AlignmentWidget({ data, initiativeId, isActive = true }: AlignmentWidgetProps) {
  const { confirmAlignment, provideFeedback, alignmentLoading } = useInitiativeStore();
  
  // Defensive: ensure we have valid data
  const alignment = data?.alignment;
  const tool = data?.tool;
  const pendingTools = data?.pending_tools || [];
  const sections = alignment?.sections || [];
  
  // All hooks must be called before any early returns (React rules of hooks)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => 
    new Set(sections.filter(s => s.include).slice(0, 3).map(s => s.id))
  );
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [localSections, setLocalSections] = useState<AlignmentSection[]>(sections);
  
  // Guard against missing data - AFTER all hooks
  if (!alignment || !tool) {
    return (
      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
        Loading alignment...
      </div>
    );
  }
  
  const ToolIcon = getIconByName(tool.icon);
  
  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };
  
  const toggleInclude = (sectionId: string) => {
    setLocalSections(prev => 
      prev.map(s => s.id === sectionId ? { ...s, include: !s.include } : s)
    );
  };
  
  const handleConfirm = async () => {
    // Check if sections were modified
    const sectionsModified = JSON.stringify(localSections) !== JSON.stringify(data.alignment.sections);
    
    await confirmAlignment(
      initiativeId, 
      alignment.tool_id,
      sectionsModified ? localSections : undefined,
      undefined
    );
  };
  
  const handleSubmitFeedback = async () => {
    if (!feedback.trim()) return;
    await provideFeedback(initiativeId, alignment.tool_id, feedback);
    setFeedback('');
    setShowFeedbackInput(false);
  };
  
  const includedCount = localSections.filter(s => s.include).length;
  
  return (
    <div className="card-elevated overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-surface-header border-b border-divider">
        <div className="flex items-center gap-2 mb-1">
          <ToolIcon className="w-5 h-5 text-accent" />
          <h3 className="font-semibold text-text-primary">{alignment.title}</h3>
        </div>
        <p className="text-sm text-text-secondary">
          {alignment.description}
        </p>
      </div>

      {/* Sections */}
      <div className="bg-white">
        <div className="px-5 py-3 border-b border-divider bg-surface-subtle">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-text-tertiary" />
              <span className="text-sm font-medium text-text-primary">
                Sections ({includedCount} of {localSections.length})
              </span>
            </div>
            {isActive && (
              <span className="text-xs text-text-tertiary">
                Click to expand • Toggle to include/exclude
              </span>
            )}
          </div>
        </div>
        
        <div className="divide-y divide-divider">
          {localSections.map((section) => {
            const isExpanded = expandedSections.has(section.id);
            
            return (
              <div key={section.id} className={`${!section.include ? 'opacity-50' : ''}`}>
                {/* Section header */}
                <div 
                  className={`
                    hover-fade px-5 py-3 flex items-center gap-3 cursor-pointer
                    ${isActive ? '' : 'pointer-events-none'}
                  `}
                  onClick={() => toggleSection(section.id)}
                >
                  {/* Include toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isActive) toggleInclude(section.id);
                    }}
                    className={`checkbox-indicator ${section.include ? 'checked' : ''}`}
                  >
                    {section.include && <Check className="w-3 h-3 text-white relative z-10" />}
                  </button>
                  
                  {/* Expand/collapse */}
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-text-tertiary" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  )}
                  
                  {/* Section info */}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-text-primary text-sm">
                      {section.title}
                    </span>
                    {!isExpanded && (
                      <span className="text-xs text-text-tertiary ml-2">
                        {section.key_points.length} points
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-5 pb-3 pl-14">
                    <p className="text-sm text-text-secondary mb-2">
                      {section.description}
                    </p>
                    {section.key_points.length > 0 && (
                      <ul className="space-y-1">
                        {section.key_points.map((point, idx) => (
                          <li key={idx} className="text-sm text-text-primary flex items-start gap-2">
                            <span className="text-accent mt-1.5">•</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Assumptions */}
      {alignment.assumptions.length > 0 && (
        <div className="px-5 py-3 bg-indicator-orange/5 border-t border-divider">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-indicator-orange mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-xs font-medium text-text-primary">Key Assumptions</span>
              <ul className="mt-1 space-y-0.5">
                {alignment.assumptions.map((assumption, idx) => (
                  <li key={idx} className="text-xs text-text-secondary">
                    • {assumption}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Parameters (if any) */}
      {alignment.parameters.length > 0 && (
        <div className="px-5 py-3 border-t border-divider bg-surface-subtle">
          <span className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
            Settings
          </span>
          <div className="mt-2 flex flex-wrap gap-3">
            {alignment.parameters.map((param) => (
              <div key={param.name} className="flex items-center gap-2">
                <span className="text-xs text-text-secondary">{param.label}:</span>
                <span className="text-xs font-medium text-text-primary bg-white px-2 py-0.5 border border-stroke-subtle rounded">
                  {param.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending tools indicator */}
      {pendingTools.length > 0 && (
        <div className="px-5 py-2 bg-surface-subtle border-t border-divider">
          <span className="text-xs text-text-tertiary">
            Next: {pendingTools.map(t => t.name).join(', ')}
          </span>
        </div>
      )}

      {/* Actions - only show when active */}
      {isActive && (
        <div className="px-5 py-4 bg-surface-header border-t border-divider space-y-3">
          {/* Feedback input */}
          {showFeedbackInput ? (
            <div className="space-y-2">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Describe changes you'd like to make..."
                className="w-full px-3 py-2 text-sm border border-stroke-subtle rounded focus:border-accent focus:ring-1 focus:ring-accent outline-none resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowFeedbackInput(false);
                    setFeedback('');
                  }}
                  className="btn-secondary flex-1 text-sm py-2"
                  disabled={alignmentLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitFeedback}
                  disabled={alignmentLoading || !feedback.trim()}
                  className="btn-primary flex-1 text-sm py-2"
                >
                  {alignmentLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Pencil className="w-4 h-4" />
                      Update Outline
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowFeedbackInput(true)}
                disabled={alignmentLoading}
                className="btn-secondary flex-1 py-2.5"
              >
                <MessageSquare className="w-4 h-4" />
                Suggest Changes
              </button>
              <button
                onClick={handleConfirm}
                disabled={alignmentLoading || includedCount === 0}
                className="btn-primary flex-1 py-2.5"
              >
                {alignmentLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Confirm Outline
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
