const ICON_BY_KEYWORD: Array<{ icon: string; keywords: string[] }> = [
  { icon: 'TrendingUp', keywords: ['market', 'demand', 'growth', 'viability', 'economic'] },
  { icon: 'Zap', keywords: ['technology', 'tech', 'innovation', 'energy', 'electrification'] },
  { icon: 'Scale', keywords: ['policy', 'regulatory', 'compliance', 'legal', 'governance'] },
  { icon: 'Users', keywords: ['stakeholder', 'community', 'consumer', 'user', 'household'] },
  { icon: 'Leaf', keywords: ['environment', 'climate', 'emission', 'carbon', 'ecology'] },
  { icon: 'CircleDollarSign', keywords: ['financial', 'finance', 'funding', 'investment', 'cost'] },
  { icon: 'Truck', keywords: ['supply', 'logistics', 'distribution', 'infrastructure', 'value chain'] },
  { icon: 'Wrench', keywords: ['operations', 'implementation', 'maintenance', 'capacity'] },
];

export function inferCategoryIconName(label: string): string {
  const normalized = label.trim().toLowerCase();
  for (const mapping of ICON_BY_KEYWORD) {
    if (mapping.keywords.some((keyword) => normalized.includes(keyword))) {
      return mapping.icon;
    }
  }
  return 'Compass';
}
