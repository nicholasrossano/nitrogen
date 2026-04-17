'use client';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConfirmationWidget } from '@/components/widgets/ConfirmationWidget';
import { CoverLetterProposedValueWidget } from '@/components/widgets/CoverLetterProposedValueWidget';
import { DeliverablesOverviewWidget } from '@/components/widgets/DeliverablesOverviewWidget';
import { DocumentRequestWidget } from '@/components/widgets/DocumentRequestWidget';
import { EvidenceInputWidget } from '@/components/widgets/EvidenceInputWidget';
import { ModuleChecklistWidget } from '@/components/widgets/ModuleChecklistWidget';
import { PlanCategoriesWidget } from '@/components/widgets/PlanCategoriesWidget';
import { PlanStructureConfirmWidget } from '@/components/widgets/PlanStructureConfirmWidget';
import { PlanSummaryWidget } from '@/components/widgets/PlanSummaryWidget';
import { ProjectPlanWidget } from '@/components/widgets/ProjectPlanWidget';
import { ProposedValueWidget } from '@/components/widgets/ProposedValueWidget';
import { TemplateProposedValueWidget } from '@/components/widgets/TemplateProposedValueWidget';

export const ABOVE_INPUT_WIDGET_TYPE = 'document_request';

interface ChatWidgetRendererProps {
  type: string;
  data: Record<string, any>;
  initiativeId?: string;
  messageId?: string;
  isActive?: boolean;
}

export function ChatWidgetRenderer({
  type,
  data,
  initiativeId,
  messageId,
  isActive = true,
}: ChatWidgetRendererProps) {
  switch (type) {
    case 'confirmation':
      return initiativeId ? (
        <ErrorBoundary>
          <ConfirmationWidget data={data} initiativeId={initiativeId} isActive={isActive} />
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
          <ModuleChecklistWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      ) : null;
    case 'deliverables_overview':
      return initiativeId ? (
        <ErrorBoundary>
          <DeliverablesOverviewWidget data={data} initiativeId={initiativeId} isActive={isActive} />
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
    case 'plan_categories':
      return initiativeId ? (
        <ErrorBoundary>
          <PlanCategoriesWidget data={data} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      ) : null;
    case 'plan_structure_confirm':
      return initiativeId ? (
        <ErrorBoundary>
          <PlanStructureConfirmWidget data={data as any} initiativeId={initiativeId} isActive={isActive} />
        </ErrorBoundary>
      ) : null;
    case 'gs_proposed_field':
      return (
        <ErrorBoundary>
          <CoverLetterProposedValueWidget data={data as any} messageId={messageId} />
        </ErrorBoundary>
      );
    case 'proposed_value':
      return (
        <ErrorBoundary>
          <ProposedValueWidget data={data as any} messageId={messageId} />
        </ErrorBoundary>
      );
    case 'template_proposed_value':
      return (
        <ErrorBoundary>
          <TemplateProposedValueWidget data={data as any} messageId={messageId} />
        </ErrorBoundary>
      );
    case ABOVE_INPUT_WIDGET_TYPE:
      return initiativeId ? (
        <ErrorBoundary>
          <DocumentRequestWidget initiativeId={initiativeId} isActive={isActive} data={data as any} />
        </ErrorBoundary>
      ) : null;
    default:
      return null;
  }
}
