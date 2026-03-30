'use client';

import { MemoViewerWidget } from './MemoViewerWidget';
import { ChecklistViewerWidget } from './ChecklistViewerWidget';
import { FileText } from 'lucide-react';
import { PanelHeader } from '@/components/ui';

interface DeliverableItem {
  module_id: string;
  module_name: string;
  widget_type: string;
  content: any;
}

interface DeliverablesListWidgetProps {
  data: Record<string, any>;
  initiativeId: string;
  isActive?: boolean;
}

export function DeliverablesListWidget({ data, initiativeId, isActive = true }: DeliverablesListWidgetProps) {
  const deliverables = (data?.deliverables || []) as DeliverableItem[];
  
  if (deliverables.length === 0) {
    return (
      <div className="card-elevated p-6">
        <p className="text-sm text-text-secondary">No deliverables generated</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {deliverables.map((deliverable, idx) => {
        // Render appropriate viewer based on widget type
        if (deliverable.widget_type === 'memo_viewer') {
          return (
            <MemoViewerWidget
              key={idx}
              data={{ content: deliverable.content, memo_id: deliverable.module_id }}
              initiativeId={initiativeId}
              isActive={isActive}
            />
          );
        } else if (deliverable.widget_type === 'checklist_viewer') {
          return (
            <ChecklistViewerWidget
              key={idx}
              data={{ content: deliverable.content, tool_name: deliverable.tool_name }}
              initiativeId={initiativeId}
              isActive={isActive}
            />
          );
        } else {
          // Generic document viewer fallback
          return (
            <div key={idx} className="card-elevated overflow-hidden">
              <PanelHeader icon={FileText} title={deliverable.tool_name} />
              <div className="p-5 bg-white">
                <pre className="text-sm text-text-secondary whitespace-pre-wrap">
                  {JSON.stringify(deliverable.content, null, 2)}
                </pre>
              </div>
            </div>
          );
        }
      })}
    </div>
  );
}
