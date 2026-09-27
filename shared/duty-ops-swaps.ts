export type ExchangeType = 'GIVE_AWAY' | 'DIRECT_SWAP';
export type RequestStatus = 'OPEN' | 'ACCEPTED' | 'CANCELLED';
export type ProposalStatus = 'OPEN' | 'ACCEPTED' | 'WITHDRAWN' | 'NOT_SELECTED';
export interface ExchangeUser { id: string; firstName: string | null; lastName: string | null }
export interface ExchangeShift { id: string | null; startsAt: string; endsAt: string }
export interface ExchangeProposal {
  id: string; proposer: ExchangeUser; offeredShift: ExchangeShift; status: ProposalStatus;
  createdAt: string; eligible: boolean;
}
export interface ExchangeRequest {
  id: string; type: ExchangeType; status: RequestStatus; requester: ExchangeUser;
  requestedShift: ExchangeShift; acceptedBy: ExchangeUser | null; acceptedProposalId: string | null;
  createdAt: string; acceptedAt: string | null; proposals: ExchangeProposal[]; eligible: boolean;
}
export interface ExchangesResponse {
  currentUserId: string; requests: ExchangeRequest[]; lockedShiftIds: string[]; nextCursor: string | null;
}
