import { useEffect, useState, type FormEvent } from 'react';
import { BackLink, PageHeader, RefreshControl } from '../app/controls';
import './exchange-audit.css';

type Person={id:string;firstName:string|null;lastName:string|null};
type Snapshot={id:string;startsAt:string;endsAt:string;status:string};
type Case={id:string;domain:string;status:string;reason:string|null;createdAt:string;source:Snapshot;
  owner:Person;candidateCount:number};
type Event={id:string;type:string;reason:string|null;createdAt:string;actor:Person|null;snapshot:Record<string,unknown>};
type Candidate={id:string;status:string;reason:string|null;created_at:string;completed_at:string|null;
  legs:{user:Person;give:Snapshot|null;receive:Snapshot|null;consentSource:string|null;consentedAt:string|null}[]};
type Detail={id:string;domain:string;status:string;reason:string|null;owner:Person;source:Snapshot;
  events:Event[];candidates:Candidate[];credits:{user:Person;amount:number;createdAt:string}[]};
const name=(person:Person)=>[person.firstName,person.lastName].filter(Boolean).join(' ')||'Student';
const when=(value:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const label=(value:string)=>value.replaceAll('_',' ').toLowerCase().replace(/^./,letter=>letter.toUpperCase());
const assignment=(value:Snapshot)=>/^\d{4}-\d{2}-\d{2}$/.test(value.startsAt)
  ? `Week of ${new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',dateStyle:'medium'})
    .format(new Date(`${value.startsAt}T12:00:00Z`))}`
  : `${when(value.startsAt)} – ${when(value.endsAt)}`;
async function getJson<T>(url:string,signal:AbortSignal):Promise<T>{
  const response=await fetch(url,{signal,credentials:'same-origin'});
  if(!response.ok)throw new Error(response.status===403?'You do not have permission to view Exchange audit.':'Could not load Exchange audit.');
  return response.json() as Promise<T>;
}
function eventSummary(event:Event){
  const data=event.snapshot;
  if(data.source&&typeof data.source==='object')return `Source: ${assignment(data.source as Snapshot)}`;
  if(data.assignment&&typeof data.assignment==='object')return `Assignment: ${assignment(data.assignment as Snapshot)}`;
  if(Array.isArray(data.legs))return `${data.legs.length} participants and assignment legs`;
  if(Array.isArray(data.creditDeltas))return `${data.creditDeltas.length} credit outcomes`;
  return null;
}
export function ExchangeAuditPage(){
  const [draft,setDraft]=useState({person:'',domain:'',status:'',from:'',to:''});
  const [filters,setFilters]=useState(draft);
  const [cases,setCases]=useState<Case[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [detail,setDetail]=useState<Detail|null>(null);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(filters))if(value)params.set(key,value);
    void getJson<{cases:Case[]}>(`/api/admin/exchanges${params.size?`?${params}`:''}`,controller.signal)
      .then(result=>{setCases(result.cases);setError('');})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load Exchange audit.');});
    return ()=>controller.abort();
  },[filters,reload]);
  useEffect(()=>{
    if(!selected){setDetail(null);return;}
    const controller=new AbortController();
    void getJson<Detail>(`/api/admin/exchanges/${selected}`,controller.signal)
      .then(result=>{setDetail(result);setError('');})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load Exchange case.');});
    return ()=>controller.abort();
  },[selected,reload]);
  const submit=(event:FormEvent)=>{event.preventDefault();setSelected(null);setFilters({...draft});};
  return <section className="exchange-audit"><BackLink to="/admin">Administration</BackLink>
    <PageHeader title="Exchange audit"><RefreshControl label="Exchange audit" onRefresh={()=>setReload(value=>value+1)} retry={!!error}/></PageHeader>
    <p>Read-only history of portal exchange intents, candidates, consent and completed outcomes.</p>
    <form className="exchange-audit-filters" onSubmit={submit}>
      <label>Person<input value={draft.person} maxLength={80} onChange={e=>setDraft({...draft,person:e.target.value})} placeholder="Student name"/></label>
      <label>Module<select value={draft.domain} onChange={e=>setDraft({...draft,domain:e.target.value})}>
        <option value="">All</option><option value="DUTY_OPS">Duty Ops</option><option value="FLYVASK">Flyvask</option><option value="BRAKKEVAKT">Brakkevakt</option>
      </select></label>
      <label>Outcome<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}>
        <option value="">All</option>{['OPEN','COMPLETED','CANCELLED','SUPERSEDED','INVALIDATED','EXPIRED'].map(status=><option key={status} value={status}>{label(status)}</option>)}
      </select></label>
      <label>From<input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
      <label>To<input type="date" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
      <button type="submit">Apply filters</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    <div className="exchange-audit-layout"><div className="exchange-audit-cases" aria-label="Exchange cases">
      {cases.length===0&&!error&&<p>No cases match these filters.</p>}
      {cases.map(item=><button key={item.id} type="button" aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>
        <strong>{name(item.owner)} · {label(item.domain)}</strong><span>{assignment(item.source)}</span>
        <small>{label(item.status)}{item.reason?` · ${label(item.reason)}`:''} · {when(item.createdAt)}</small>
      </button>)}
    </div><div className="exchange-audit-detail" aria-live="polite">
      {!selected&&<p>Select an exchange to inspect its timeline.</p>}
      {selected&&!detail&&<p>Loading case…</p>}
      {detail&&<><h2>{name(detail.owner)} · {label(detail.domain)}</h2>
        <p>{assignment(detail.source)} · {label(detail.status)}{detail.reason?` (${label(detail.reason)})`:''}</p>
        <ol className="exchange-audit-timeline">{detail.events.map(event=><li key={event.id}>
          <time dateTime={event.createdAt}>{when(event.createdAt)}</time>
          <div><strong>{label(event.type)}</strong>{event.actor&&<span> · {name(event.actor)}</span>}
            {event.reason&&<span> · {label(event.reason)}</span>}
            {eventSummary(event)&&<p>{eventSummary(event)}</p>}</div>
        </li>)}</ol>
        {detail.candidates.length>0&&<section><h3>Candidate outcomes</h3>
          <ol className="exchange-audit-candidates">{detail.candidates.map(candidate=><li key={candidate.id}>
            <strong>{label(candidate.status)}</strong>{candidate.reason&&<span> · {label(candidate.reason)}</span>}
            <ul>{candidate.legs.map(leg=><li key={leg.user.id}>
              {name(leg.user)}: {leg.give?assignment(leg.give):'No shift'} → {leg.receive?assignment(leg.receive):'No shift'}
              <small> · {leg.consentSource?`Consented via ${label(leg.consentSource)}`:'Awaiting consent'}</small>
            </li>)}</ul>
          </li>)}</ol>
        </section>}
        {detail.credits.length>0&&<section><h3>Duty Ops credit changes</h3><ul>{detail.credits.map((credit,index)=><li key={index}>{name(credit.user)}: {credit.amount>0?'+':''}{credit.amount}</li>)}</ul></section>}
      </>}
    </div></div>
  </section>;
}
