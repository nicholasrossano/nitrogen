import { 
  FileText, 
  CheckSquare,
  LucideIcon,
} from 'lucide-react';

/**
 * Maps icon names from backend to lucide-react icon components
 */
const iconMap: Record<string, LucideIcon> = {
  FileText,
  CheckSquare,
};

/**
 * Get a lucide-react icon component by name
 * Returns FileText as fallback if icon name not found
 */
export function getIconByName(iconName: string): LucideIcon {
  return iconMap[iconName] || FileText;
}
