type ExchangeInboxItem={title:string;summary:string|null;target:{path:string;exchangeId:string}|null};
const path=(domain:string)=>domain==='DUTY_OPS'?'/duty-ops':domain==='FLYVASK'?'/flyvask':'/brakkevakt';
export async function resolveExchangeInbox(db:D1Database,sourceIds:string[],userId:string):Promise<Map<string,ExchangeInboxItem>>{
  const items=new Map<string,ExchangeInboxItem>();
  if(!sourceIds.length)return items;
  const ids=JSON.stringify(sourceIds);
  const [targets,candidates]=await db.batch([
    db.prepare(`SELECT t.id,t.status,i.status intent_status,i.domain,i.id intent_id,
      CASE i.domain
        WHEN 'DUTY_OPS' THEN EXISTS(SELECT 1 FROM duty_ops_effective_assignments a
          WHERE a.shift_id=t.assignment_id AND a.user_id=?)
        WHEN 'FLYVASK' THEN EXISTS(SELECT 1 FROM flyvask_effective_assignments a
          WHERE a.shift_id=t.assignment_id AND a.user_id=?)
        ELSE EXISTS(SELECT 1 FROM brakkevakt_assignments a
          WHERE a.id=t.assignment_id AND a.user_id=?) END current_member
      FROM exchange_v2_targets t JOIN exchange_v2_intents i ON i.id=t.intent_id
      WHERE t.id IN (SELECT value FROM json_each(?))`).bind(userId,userId,userId,ids),
    db.prepare(`SELECT c.id,c.status,i.domain,i.id intent_id,l.consented_at
      FROM exchange_v2_candidates c JOIN exchange_v2_intents i ON i.id=c.intent_id
      LEFT JOIN exchange_v2_candidate_legs l ON l.candidate_id=c.id AND l.user_id=?
      WHERE c.id IN (SELECT value FROM json_each(?))`).bind(userId,ids),
  ]);
  for(const row of targets.results as {id:string;status:string;intent_status:string;domain:string;intent_id:string;current_member:number}[]){
    const actionable=row.status==='OPEN'&&row.intent_status==='OPEN'&&!!row.current_member;
    items.set(row.id,{title:actionable?'Swap request':'Swap no longer available',
      summary:actionable?'An assignment you hold was selected as a swap target.':null,
      target:{path:path(row.domain),exchangeId:row.intent_id}});
  }
  for(const row of candidates.results as {id:string;status:string;domain:string;intent_id:string;consented_at:string|null}[]){
    const review=row.status==='WAITING'&&!row.consented_at;
    const title=row.status==='COMPLETED'?'Exchange agreed':review?'Review exchange':
      row.status==='WAITING'?'Waiting for others':'Exchange no longer available';
    const summary=row.status==='COMPLETED'?'Your portal schedule changed. FlightLogger may still need updating.':
      review?'Your exact exchange outcome needs a decision.':null;
    items.set(row.id,{title,summary,target:{path:path(row.domain),exchangeId:row.intent_id}});
  }
  return items;
}
