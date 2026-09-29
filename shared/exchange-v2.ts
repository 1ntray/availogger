export const EXCHANGE_DOMAINS = ['DUTY_OPS', 'FLYVASK', 'BRAKKEVAKT'] as const;
export type ExchangeDomain = typeof EXCHANGE_DOMAINS[number];
export type ExchangeTerminalReason = 'SOURCE_ASSIGNMENT_CHANGED' | 'TARGET_ASSIGNMENT_CHANGED' |
  'PARTICIPANT_NO_LONGER_ASSIGNED' | 'SHIFT_CANCELLED' | 'CONFLICTING_EXCHANGE_COMPLETED' |
  'CREDIT_CONSTRAINT_CHANGED' | 'ASSIGNMENT_EXPIRED';
export type ExchangeStatus = 'OPEN' | 'WAITING' | 'COMPLETED' | 'CANCELLED' | 'DECLINED' |
  'WITHDRAWN' | 'SUPERSEDED' | 'INVALIDATED' | 'EXPIRED';
export type ExchangeAction = 'OPEN_EXCHANGE' | 'CANCEL_INTENT' | 'OFFER_SHIFT' |
  'TAKE_GIVE_AWAY' | 'ACCEPT_TARGET' | 'WITHDRAW_OFFER' | 'CONFIRM_CANDIDATE' |
  'DECLINE_CANDIDATE' | 'VIEW_EXCHANGE';
export type ExchangeRelationship = 'OWN_IDLE' | 'OWN_EXCHANGE_OPEN' | 'INCOMING_REQUEST' |
  'SWAP_AVAILABLE' | 'GIVE_AWAY_AVAILABLE' | 'OFFER_SENT' | 'REVIEW_OFFER' |
  'CANDIDATE_REVIEW_REQUIRED' | 'CANDIDATE_WAITING' | 'NONE';
export interface AssignmentActionState {
  assignmentId: string;
  relationship: ExchangeRelationship;
  availableActions: ExchangeAction[];
  relatedIntentIds: string[];
  relatedCandidateIds: string[];
}
export interface ExchangeAssignmentSnapshot {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  weekStart?: string;
  version: string;
}
export interface ExchangeLeg {
  userId: string;
  giveAssignmentId: string | null;
  receiveAssignmentId: string | null;
  giveVersion: string | null;
  receiveVersion: string | null;
  consentSource: 'TARGET' | 'OFFER' | 'GIVE_AWAY' | 'CLAIM' | 'CONFIRMATION' | null;
  consentedAt: string | null;
}
