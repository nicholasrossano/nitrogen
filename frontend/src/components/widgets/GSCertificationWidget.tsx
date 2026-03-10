'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Award,
  CheckCircle2,
  Circle,
  Lock,
  FileText,
  ExternalLink,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { CoverLetterEditor } from './CoverLetterEditor';
import { api } from '@/lib/api';
import { useChatStore } from '@/stores/chatStore';

interface ChecklistItem {
  id: string;
  name: string;
  supported: boolean;
  description: string;
  conditional?: boolean;
  template_url?: string | null;
}

interface GSCertificationWidgetProps {
  data: Record<string, any>;
  initiativeId?: string;
  messageId?: string;
}

type Tab = 'checklist' | 'cover_letter';

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-surface-subtle', text: 'text-text-tertiary', label: 'Not Started' },
  in_progress: { bg: 'bg-indicator-yellow/10', text: 'text-indicator-yellow', label: 'In Progress' },
  complete: { bg: 'bg-indicator-green/10', text: 'text-indicator-green', label: 'Complete' },
  not_supported_yet: { bg: 'bg-surface-subtle', text: 'text-text-tertiary', label: 'Not Supported Yet' },
};

export function GSCertificationWidget({ data, initiativeId, messageId }: GSCertificationWidgetProps) {
  const [activeTab, setActiveTab] = useState<Tab>('checklist');
  const [workspaceId, setWorkspaceId] = useState<string | null>(data.workspace_id || null);
  const [checklistState, setChecklistState] = useState<Record<string, { status: string }>>({});
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});
  const [completion, setCompletion] = useState<any>(null);
  const sessionId = useChatStore((s) => s.currentDbSessionId);

  const ensureWorkspace = useCallback(async () => {
    if (workspaceId) return workspaceId;
    try {
      const ws = await api.createGSWorkspace(initiativeId || undefined, sessionId || undefined);
      setWorkspaceId(ws.id);
      setChecklistState(ws.checklist_state || {});
      setFieldValues(ws.field_values || {});
      return ws.id as string;
    } catch (err) {
      console.error('Failed to create GS workspace', err);
      return null;
    }
  }, [workspaceId, initiativeId, sessionId]);

  useEffect(() => {
    ensureWorkspace();
  }, [ensureWorkspace]);

  const handleOpenCoverLetter = useCallback(() => {
    setActiveTab('cover_letter');
  }, []);

  const handleFieldsUpdated = useCallback((newFields: Record<string, any>, newCompletion: any) => {
    setFieldValues(newFields);
    setCompletion(newCompletion);
  }, []);

  const handleChecklistUpdate = useCallback(async (itemId: string, status: string) => {
    const wsId = await ensureWorkspace();
    if (!wsId) return;
    try {
      const result = await api.updateGSChecklistState(wsId, itemId, status);
      setChecklistState(result.checklist_state || {});
    } catch (err) {
      console.error('Failed to update checklist', err);
    }
  }, [ensureWorkspace]);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-divider bg-white">
        <button
          onClick={() => setActiveTab('checklist')}
          className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
            activeTab === 'checklist'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Checklist
        </button>
        <button
          onClick={() => setActiveTab('cover_letter')}
          className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
            activeTab === 'cover_letter'
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Cover Letter
          {completion && (
            <span className="ml-1.5 text-[10px] text-text-tertiary">
              {completion.filled_fields}/{completion.total_fields}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'checklist' ? (
          <ChecklistTab
            items={data.checklist_items}
            checklistState={checklistState}
            templateStatus={data.template_status}
            templateLabel={data.template_version_label}
            onOpenCoverLetter={handleOpenCoverLetter}
            onUpdateStatus={handleChecklistUpdate}
            completion={completion}
          />
        ) : (
          <CoverLetterEditor
            fieldSchema={data.field_schema}
            htmlPreview={data.html_preview}
            fieldValues={fieldValues}
            workspaceId={workspaceId}
            onFieldsUpdated={handleFieldsUpdated}
          />
        )}
      </div>
    </div>
  );
}


function ChecklistTab({
  items,
  checklistState,
  templateStatus,
  templateLabel,
  onOpenCoverLetter,
  onUpdateStatus,
  completion,
}: {
  items: ChecklistItem[];
  checklistState: Record<string, { status: string }>;
  templateStatus: string | null;
  templateLabel: string | null;
  onOpenCoverLetter: () => void;
  onUpdateStatus: (itemId: string, status: string) => void;
  completion: any;
}) {
  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-accent-wash rounded flex items-center justify-center flex-shrink-0">
          <Award className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Gold Standard Certification
          </h3>
          <p className="text-xs text-text-secondary mt-0.5">
            Design / Pre-monitoring submission requirements
          </p>
        </div>
      </div>

      {templateStatus === 'draft' && (
        <div className="flex items-start gap-2 p-3 rounded border border-indicator-yellow/30 bg-indicator-yellow/5">
          <AlertTriangle className="w-4 h-4 text-indicator-yellow flex-shrink-0 mt-0.5" />
          <div className="text-xs text-text-secondary">
            <span className="font-medium text-text-primary">Template pending approval.</span>{' '}
            Using draft template {templateLabel || ''}. Exports will include a draft notice until approved.
          </div>
        </div>
      )}

      {/* Items */}
      <div className="space-y-2">
        {items.map((item) => {
          const state = checklistState[item.id];
          const itemStatus = item.supported
            ? (state?.status || 'not_started')
            : 'not_supported_yet';
          const config = STATUS_CONFIG[itemStatus] || STATUS_CONFIG.not_started;

          // For cover letter, reflect completion
          const coverLetterStatus = item.id === 'cover_letter' && completion
            ? completion.status === 'complete' || completion.status === 'ready_for_signature'
              ? 'complete'
              : completion.filled_fields > 0
                ? 'in_progress'
                : 'not_started'
            : itemStatus;
          const displayConfig = item.id === 'cover_letter' && completion
            ? STATUS_CONFIG[coverLetterStatus] || config
            : config;

          return (
            <div
              key={item.id}
              className={`rounded border border-stroke-subtle overflow-hidden ${
                item.supported ? 'cursor-pointer hover:border-accent/30' : ''
              }`}
              onClick={() => {
                if (item.id === 'cover_letter') onOpenCoverLetter();
              }}
            >
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="flex-shrink-0">
                  {coverLetterStatus === 'complete' ? (
                    <CheckCircle2 className="w-4.5 h-4.5 text-indicator-green" />
                  ) : coverLetterStatus === 'in_progress' ? (
                    <Circle className="w-4.5 h-4.5 text-indicator-yellow" />
                  ) : !item.supported ? (
                    <Lock className="w-4 h-4 text-text-tertiary" />
                  ) : (
                    <Circle className="w-4 h-4 text-divider" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {item.name}
                    </span>
                    {item.conditional && (
                      <span className="text-[10px] text-text-tertiary">(conditional)</span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                    {item.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${displayConfig.bg} ${displayConfig.text}`}>
                    {displayConfig.label}
                  </span>
                  {item.supported && (
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  )}
                  {!item.supported && item.template_url && (
                    <a
                      href={item.template_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-text-tertiary hover:text-accent transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
