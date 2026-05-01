'use client';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConfirmationWidget } from '@/components/widgets/ConfirmationWidget';
import { DeliverablesOverviewWidget } from '@/components/widgets/DeliverablesOverviewWidget';
import { DocumentRequestWidget } from '@/components/widgets/DocumentRequestWidget';
import { EvidenceInputWidget } from '@/components/widgets/EvidenceInputWidget';
import { AssessmentChecklistWidget } from '@/components/widgets/AssessmentChecklistWidget';
import { PlanSummaryWidget } from '@/components/widgets/PlanSummaryWidget';
import { ProjectPlanWidget } from '@/components/widgets/ProjectPlanWidget';
import { ProposedValueWidget, type ProposedValueApplyRequest } from '@/components/widgets/ProposedValueWidget';
import { TemplateProposedValueWidget } from '@/components/widgets/TemplateProposedValueWidget';

export const ABOVE_INPUT_WIDGET_TYPE = 'document_request';

interface ChatWidgetRendererProps {
  type: string;
  data: Record<string, any>;
  initiativeId?: string;
  messageId?: string;
  isActive?: boolean;
  onSendMessage?: (content: string) => void | Promise<void>;
  onDocumentRequestMessage?: (content: string) => void | Promise<void>;
  onApplyProposedValue?: (request: ProposedValueApplyRequest) => boolean | Promise<boolean>;
}

export function ChatWidgetRenderer({
  type,
  data,
  initiativeId,
  messageId,
  isActive = true,
  onSendMessage,
  onDocumentRequestMessage,
  onApplyProposedValue,
}: ChatWidgetRendererProps) {
  switch (type) {
    case 'confirmation':
      return initiativeId ? (
        <ErrorBoundary>
          <ConfirmationWidget
            data={data}
            initiativeId={initiativeId}
            isActive={isActive}
            onSendMessage={onSendMessage}
          />
        </ErrorBoundary>
      ) : null;
    case 'evidence_input':
      return initiativeId ? (
        <ErrorBoundary>
          <EvidenceInputWidget initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      ) : null;
    case 'tool_checklist':
      return initiativeId ? (
        <ErrorBoundary>
          <AssessmentChecklistWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      ) : null;
    case 'deliverables_overview':
      return initiativeId ? (
        <ErrorBoundary>
          <DeliverablesOverviewWidget
            data={data}
            initiativeId={initiativeId}
            isActive={isActive}
            onSendMessage={onSendMessage}
          />
        </ErrorBoundary>
      ) : null;
    case 'project_plan':
      return initiativeId ? (
        <ErrorBoundary>
          <ProjectPlanWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      ) : null;
    case 'plan_summary':
      return (
        <ErrorBoundary>
          <PlanSummaryWidget data={data as any} />
        </ErrorBoundary>
      );
    case 'proposed_value':
      return (
        <ErrorBoundary>
          <ProposedValueWidget
            data={data as any}
            initiativeId={initiativeId}
            messageId={messageId}
            onApplyValue={onApplyProposedValue}
          />
        </ErrorBoundary>
      );
    case 'template_proposed_value':
      return (
        <ErrorBoundary>
          <TemplateProposedValueWidget data={data as any} initiativeId={initiativeId} messageId={messageId} />
        </ErrorBoundary>
      );
    case ABOVE_INPUT_WIDGET_TYPE:
      return initiativeId ? (
        <ErrorBoundary>
          <DocumentRequestWidget
            initiativeId={initiativeId}
            isActive={isActive}
            data={data as any}
            onSendMessage={onDocumentRequestMessage}
          />
        </ErrorBoundary>
      ) : null;
    default:
      return null;
  }
}
