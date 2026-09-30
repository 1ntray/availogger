import { useEffect,useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { PERMISSIONS } from '../../../shared/authorization';
import { changeFuel,loadFlights,type Flight,type FlightsData,type FuelChoice } from '../features/flights/api';
import { flightClock,flightLessonLabels,flightSegments } from '../features/flights/presentation';
import { AttentionDetail } from '../app/AttentionDetail';
import { ActionButton, PageHeader, RefreshControl } from '../app/controls';
import '../features/flights/flights.css';

const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',weekday:'short',day:'numeric',month:'short'});
function Segment({label,start,end}:{label:string;start:string|null;end:string|null}){return <span className="flight-segment"><span>{label}</span>
  <strong>{start?<time dateTime={start}>{flightClock(start)}</time>:'—'}{end&&<>–<time dateTime={end}>{flightClock(end)}</time></>}</strong></span>;}
function label(flight:Flight){const r=flight.request;
  return !r?'No fuel request':r.status==='NEEDS_REVIEW'?'Needs review':r.status==='COMPLETED'?
    r.appliesToCurrentAircraft?'Completed':'Completed for previous aircraft':r.status==='PENDING'?'Pending':'Cancelled';}
function FuelForm({flight,onChanged,onClose}:{flight:Flight;onChanged:()=>void;onClose:()=>void}){
  const [kind,setKind]=useState<'PRESET'|'QUANTITY'>(flight.profile?.presets.length?'PRESET':'QUANTITY');
  const [preset,setPreset]=useState(flight.profile?.presets[0]?.key??'');
  const [quantity,setQuantity]=useState(flight.request?.requestKind==='QUANTITY'?String(flight.request.quantityValue??''):'');
  const [unit,setUnit]=useState<'L'|'US_GAL'>('L');
  const profile=flight.profile?.id,customUnit=profile==='C182T'?'US_GAL':profile==='Z242L'?'L':unit;
  const amount=Number(quantity),z242=profile==='Z242L'&&quantity!==''&&Number.isFinite(amount)&&amount>=116
    ?{aux:amount-116,each:(amount-116)/2}:null;
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const send=async()=>{setError('');setBusy(true);try{
    const choice:FuelChoice=kind==='PRESET'?{kind,presetKey:preset}:{kind,quantityValue:Number(quantity),quantityUnit:customUnit};
    await changeFuel(flight.id,flight.request?'PUT':'POST',choice);onChanged();onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not save fuel request.');}finally{setBusy(false);}};
  return <form className="fuel-form" onSubmit={event=>{event.preventDefault();void send();}}>
    <strong>{flight.request?.status==='NEEDS_REVIEW'?'Review fuel for current aircraft':flight.request?'Change fuel request':'Request fuel'}</strong>
    <label>Fuel option<select value={kind} onChange={e=>setKind(e.target.value as 'PRESET'|'QUANTITY')}>
      {flight.profile?.presets.length&&<option value="PRESET">Preset</option>}<option value="QUANTITY">Add quantity</option>
    </select></label>
    {kind==='PRESET'?<label>Preset<select value={preset} onChange={e=>setPreset(e.target.value)}>{flight.profile?.presets.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
      :<><label>{profile==='Z242L'?'Desired total fuel':'Amount'}<span className="fuel-amount"><input type="number" min={profile==='Z242L'?'116':'0.1'} max="1000" step="any" required value={quantity} onChange={e=>setQuantity(e.target.value)} />
        {profile==='C182T'&&<span>US gal</span>}{profile==='Z242L'&&<span>L</span>}</span></label>
        {!['C182T','Z242L'].includes(profile??'')&&<label>Unit<select value={unit} onChange={e=>setUnit(e.target.value as 'L'|'US_GAL')}><option value="L">L</option><option value="US_GAL">US gal</option></select></label>}
        {z242&&<dl className="fuel-distribution"><div><dt>Mains total</dt><dd>116 L</dd></div><div><dt>Aux total</dt><dd>{z242.aux} L</dd></div><div><dt>Each aux tank</dt><dd>{z242.each} L</dd></div></dl>}</>}
    {error&&<p className="fuel-error" role="alert">{error}</p>}
    <div className="fuel-form-actions"><ActionButton variant="primary" disabled={busy||kind==='PRESET'&&!preset} type="submit">Save request</ActionButton><ActionButton variant="ghost" onClick={onClose}>Close</ActionButton></div>
  </form>;
}
export function FlightsPage(){
  const {user,refresh}=useCurrentUser();const canRequest=user?.permissions?.includes(PERMISSIONS.fuelRequest)===true;
  const [data,setData]=useState<FlightsData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0);
  const [editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    loadFlights(controller.signal).then(setData).catch(cause=>{if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Flights could not be loaded.');
      if(cause?.name==='OnboardingRequiredError')void refresh().catch(()=>{});}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();},[reload,refresh]);
  const cancel=async(flight:Flight)=>{if(!window.confirm('Cancel this fuel request?'))return;setBusy(flight.id);setError('');
    try{await changeFuel(flight.id,'DELETE');setReload(n=>n+1);}catch(cause){setError(cause instanceof Error?cause.message:'Could not cancel.');}finally{setBusy(null);}};
  const upcoming=data?.flights.filter(f=>Date.parse(f.endsAt)>Date.now()&&f.status!=='CANCELLED')??[];
  return <section className="flights-page"><PageHeader title="Flights"><RefreshControl label="flights" onRefresh={()=>setReload(n=>n+1)} loading={loading} retry={!!error || !!data?.sync.stale} updatedAt={data?.sync.lastSyncedAt} /></PageHeader>
    {loading&&!data&&<p role="status">Loading flights…</p>}{error&&<p className="fuel-error" role="alert">{error}</p>}
    {data?.sync.stale&&<div role="status"><AttentionDetail label="Flights may be out of date"><p>{data.sync.warning??'Showing previously synchronized flights.'}</p></AttentionDetail></div>}
    <h2>Upcoming flights</h2>{!loading&&!upcoming.length&&<p className="fuel-notice">No upcoming flights in the synchronized window.</p>}
    <ul className="flight-list">{upcoming.map(f=>{const segments=flightSegments(f),lessons=flightLessonLabels(f);return <li className="flight-row" key={f.id}>
      <div className="flight-row-head"><strong><time dateTime={f.startsAt}>{date.format(new Date(f.startsAt))}</time></strong>
        <span>{f.aircraft?.callSign??'Aircraft pending'}</span><span className="flight-status">{label(f)}</span></div>
      <div className="flight-segments"><Segment label="Brief" {...segments.brief}/>{segments.flight&&<Segment label="Flight" {...segments.flight}/>}{segments.end&&<Segment label="End" {...segments.end}/>}</div>
      {lessons.length>0&&<p className="flight-meta">{lessons.length===1?'Lesson':'Lessons'}: {lessons.join(' · ')}</p>}
      {f.instructor&&<p className="flight-meta">Instructor: {f.instructor}</p>}
      {f.request&&<p className="flight-meta">{f.request.requestKind==='PRESET'?f.request.presetLabel:
        f.profile?.id==='Z242L'?`Desired total ${f.request.quantityValue} L`:`${f.request.quantityValue} ${f.request.quantityUnit}`}
        {f.request.status==='NEEDS_REVIEW'?' · Aircraft or departure changed; choose fuel again.':''}</p>}
      {canRequest&&f.canOrder&&f.profile&&<div className="flight-actions">
        {f.request?.status!=='COMPLETED'&&<button onClick={()=>setEditing(editing===f.id?null:f.id)}>{f.request?'Edit fuel':'Request fuel'}</button>}
        {f.request?.status==='PENDING'&&<button disabled={busy===f.id} onClick={()=>void cancel(f)}>Cancel request</button>}
      </div>}
      {editing===f.id&&f.profile&&<FuelForm flight={f} onChanged={()=>setReload(n=>n+1)} onClose={()=>setEditing(null)} />}
    </li>})}</ul>
  </section>;
}
