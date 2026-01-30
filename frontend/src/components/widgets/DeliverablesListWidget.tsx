'use client';

import { MemoViewerWidget } from './MemoViewerWidget';
import { ChecklistViewerWidget } from './ChecklistViewerWidget';

interface DeliverableItem {
  tool_id: string;
  tool_name: string;
  widget_type: string;
  content: any;
}

interface DeliverablesListWidgetProps {
  data: {
    deliverables: DeliverableItem[];
  };
  initiativeId: string;
  isActive?: boolean;
}

export function DeliverablesListWidget({ data, initiativeId, isActive = true }: DeliverablesListWidgetProps) {
  const deliverables = data?.deliverables || [];
  
  if (deliverables.length === 0) {
    return (
      <div className="card-elevated p-6">
        <p className="text-brown/60">No deliverables generated</p>
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
              data={{ content: deliverable.content, memo_id: deliverable.tool_id }}
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
              <div className="px-5 py-4 bg-gradient-to-r from-primary-50 to-accent/10 border-b border-beige/50">
                <h3 className="font-semibold text-brown">{deliverable.tool_name}</h3>
              </div>
              <div className="p-5 bg-cream">
                <pre className="text-sm text-brown/80 whitespace-pre-wrap">
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
