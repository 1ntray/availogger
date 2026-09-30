import { createContext, useContext, type ReactNode } from 'react';

export type LegacyOpportunity = { id: string; label: string; description: string; action: ReactNode };
const LegacyContext = createContext<LegacyOpportunity[]>([]);
export function LegacyOpportunityProvider({ items, children }: { items: LegacyOpportunity[]; children: ReactNode }) {
  return <LegacyContext.Provider value={items}>{children}</LegacyContext.Provider>;
}
export function useLegacyOpportunities() { return useContext(LegacyContext); }
