import type { NamedUser } from './display-name';
export interface BrakkevaktPerson extends NamedUser { id: string }
export interface BrakkevaktAssignment { id: string; slot: 1 | 2; user: BrakkevaktPerson }
export interface BrakkevaktWeek { id: string; weekStart: string; revision: number; assignments: [BrakkevaktAssignment, BrakkevaktAssignment] }
export interface BrakkevaktSchedule { currentUserId: string; currentWeekStart: string; weeks: BrakkevaktWeek[] }
export interface BrakkevaktRoster { students: BrakkevaktPerson[] }
export interface BrakkevaktSwapProposal { id: string; proposer: BrakkevaktPerson; offeredAssignmentId: string | null; offeredWeekStart: string; status: 'OPEN' | 'ACCEPTED' | 'WITHDRAWN' | 'NOT_SELECTED' | 'INVALIDATED'; createdAt: string; eligible: boolean }
export interface BrakkevaktSwapRequest { id: string; requester: BrakkevaktPerson; requestedAssignmentId: string | null; requestedWeekStart: string; status: 'OPEN' | 'ACCEPTED' | 'CANCELLED' | 'INVALIDATED'; proposals: BrakkevaktSwapProposal[]; createdAt: string; eligible: boolean }
export interface BrakkevaktSwaps { currentUserId: string; requests: BrakkevaktSwapRequest[]; lockedAssignmentIds: string[]; nextCursor: string | null }
export interface BrakkevaktSwapHistoryEntry { id: string; counterparty: BrakkevaktPerson; givenWeekStart: string; receivedWeekStart: string; acceptedAt: string }
export interface BrakkevaktSwapHistory { entries: BrakkevaktSwapHistoryEntry[]; nextCursor: string | null }
