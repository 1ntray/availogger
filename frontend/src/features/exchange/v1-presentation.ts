// Temporary v1 presentation mapping. Keep assignment relationships here until the
// exchange API supplies canonical relationship and availableActions fields.
type Person = { id: string };
type Proposal = { status: string; proposer: Person; eligible: boolean };
type Request<P extends Proposal> = { status: string; requester: Person; proposals: P[]; eligible: boolean };

export function openRequests<R extends Request<Proposal>>(requests: R[]): R[] {
  return requests.filter(request => request.status === 'OPEN');
}

export function openProposals<R extends Request<Proposal>>(request: R): R['proposals'] {
  return request.proposals.filter(proposal => proposal.status === 'OPEN');
}

export function ownRequestFor<R extends Request<Proposal>>(requests: R[], userId: string, assignmentId: string,
  requestedId: (request: R) => string | null): R | undefined {
  return openRequests(requests).find(request => request.requester.id === userId && requestedId(request) === assignmentId);
}

export function ownOfferFor<R extends Request<Proposal>>(requests: R[], userId: string, assignmentId: string,
  offeredId: (proposal: R['proposals'][number]) => string | null): { request: R; proposal: R['proposals'][number] } | undefined {
  for (const request of openRequests(requests)) {
    const proposal = openProposals(request).find(item => item.proposer.id === userId && offeredId(item) === assignmentId);
    if (proposal) return { request, proposal };
  }
  return undefined;
}

export function hasOwnOpenOffer<R extends Request<Proposal>>(request: R, userId: string): boolean {
  return openProposals(request).some(proposal => proposal.proposer.id === userId);
}
