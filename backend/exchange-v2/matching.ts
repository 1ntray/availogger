// Deterministic bounded graph search. These edges represent explicit target
// consent only; an implicit open offer is never counted as consent.
export interface MatchIntent { id:string; ownerUserId:string; sourceAssignmentId:string; targets:string[] }
export interface MatchCycle { intentIds:string[]; consented:boolean[] }

export function findDirectMatches(root:MatchIntent,all:MatchIntent[]):MatchCycle[] {
  return all.filter(other=>other.id!==root.id&&other.ownerUserId!==root.ownerUserId&&
    root.targets.includes(other.sourceAssignmentId)&&other.targets.includes(root.sourceAssignmentId))
    .map(other=>({intentIds:[root.id,other.id],consented:[true,true]}));
}

export function findThreeWayCycles(root:MatchIntent,all:MatchIntent[]):MatchCycle[] {
  const found:MatchCycle[]=[];
  for(const second of all){
    if(second.id===root.id||second.ownerUserId===root.ownerUserId||!root.targets.includes(second.sourceAssignmentId))continue;
    for(const third of all){
      if(third.id===root.id||third.id===second.id||third.ownerUserId===root.ownerUserId||
        third.ownerUserId===second.ownerUserId||!second.targets.includes(third.sourceAssignmentId)||
        third.sourceAssignmentId===root.sourceAssignmentId)continue;
      found.push({intentIds:[root.id,second.id,third.id],
        consented:[true,true,third.targets.includes(root.sourceAssignmentId)]});
    }
  }
  return found;
}

export function matchKey(domain:string,intentIds:string[]):string {
  // Rotations describe the same cycle. Reversing a three-way cycle describes
  // different give/receive legs and must remain a separate candidate.
  const first=intentIds.indexOf([...intentIds].sort()[0]);
  return `${domain}:${[...intentIds.slice(first),...intentIds.slice(0,first)].join(':')}`;
}
