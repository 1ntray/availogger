import { useEffect,useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { PERMISSIONS } from '../../../shared/authorization';
import { changeFuel,loadFlights,type Flight,type FlightsData,type FuelChoice } from '../features/flights/api';
import { AttentionDetail } from '../app/AttentionDetail';
import '../features/flights/flights.css';

const time=(value:string|null)=>value?new Intl.DateTimeFormat('en',{timeZone:'Europe/Oslo',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'Time not set';
const shortTime=(value:string|null)=>value?new Intl.DateTimeFormat('en',{timeZone:'Europe/Oslo',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
function label(flight:Flight){const r=flight.request;
  return !r?'No fuel request':r.status==='NEEDS_REVIEW'?'Needs review':r.status==='COMPLETED'?
    r.appliesToCurrentAircraft?'Completed':'Completed for previous aircraft':r.status==='PENDING'?'Pending':'Cancelled';}
function FuelForm({flight,onChanged,onClose}:{flight:Flight;onChanged:()=>void;onClose:()=>void}){
  const [kind,setKind]=useState<'PRESET'|'QUANTITY'>(flight.profile?.presets.length?'PRESET':'QUANTITY');
  const [preset,setPreset]=useState(flight.profile?.presets[0]?.key??'');
  const [quantity,setQuantity]=useState('');const [unit,setUnit]=useState<'L'|'US_GAL'>('L');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const send=async()=>{setError('');setBusy(true);try{
    const choice:FuelChoice=kind==='PRESET'?{kind,presetKey:preset}:{kind,quantityValue:Number(quantity),quantityUnit:unit};
    await changeFuel(flight.id,flight.request?'PUT':'POST',choice);onChanged();onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not save fuel request.');}finally{setBusy(false);}};
  return <form className="fuel-form" onSubmit={event=>{event.preventDefault();void send();}}>
    <strong>{flight.request?.status==='NEEDS_REVIEW'?'Review fuel for current aircraft':flight.request?'Change fuel request':'Request fuel'}</strong>
    <label>Fuel option<select value={kind} onChange={e=>setKind(e.target.value as 'PRESET'|'QUANTITY')}>
      {flight.profile?.presets.length&&<option value="PRESET">Preset</option>}<option value="QUANTITY">Add quantity</option>
    </select></label>
    {kind==='PRESET'?<label>Preset<select value={preset} onChange={e=>setPreset(e.target.value)}>{flight.profile?.presets.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
      :<><label>Quantity<input type="number" min="0.1" max="1000" step="any" required value={quantity} onChange={e=>setQuantity(e.target.value)} /></label>
        <label>Unit<select value={unit} onChange={e=>setUnit(e.target.value as 'L'|'US_GAL')}><option value="L">L</option><option value="US_GAL">US gal</option></select></label></>}
    {error&&<p className="fuel-error" role="alert">{error}</p>}
    <div className="fuel-form-actions"><button disabled={busy||kind==='PRESET'&&!preset} type="submit">Save request</button><button type="button" onClick={onClose}>Close</button></div>
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
  return <section className="flights-page"><div className="flights-heading"><h1>Flights</h1><button disabled={loading} onClick={()=>setReload(n=>n+1)}>Reload</button></div>
    <p className="flight-meta">Europe/Oslo</p>
    {loading&&<p role="status">Loading flights…</p>}{error&&<p className="fuel-error" role="alert">{error}</p>}
    {data?.sync.stale&&<div role="status"><AttentionDetail label="Flights may be out of date"><p>{data.sync.warning??'Showing previously synchronized flights.'}</p></AttentionDetail></div>}
    <h2>Upcoming flights</h2>{!loading&&!upcoming.length&&<p className="fuel-notice">No upcoming flights in the synchronized window.</p>}
    <ul className="flight-list">{upcoming.map(f=><li className="flight-row" key={f.id}>
      <div className="flight-row-head"><strong><time dateTime={f.flightStartsAt??f.startsAt}>{time(f.flightStartsAt??f.startsAt)}</time>–{shortTime(f.flightEndsAt??f.endsAt)}</strong>
        <span>{f.aircraft?.callSign??'Aircraft pending'}{f.aircraft?.model?` · ${f.aircraft.model}`:''}</span><span className="flight-status">{label(f)}</span></div>
      <p className="flight-meta">{f.departureAirport?.name??'Departure pending'} → {f.arrivalAirport?.name??'Arrival pending'}{f.instructor?` · ${f.instructor}`:''}</p>
      {f.request&&<p className="flight-meta">{f.request.requestKind==='PRESET'?f.request.presetLabel:`${f.request.quantityValue} ${f.request.quantityUnit}`}
        {f.request.status==='NEEDS_REVIEW'?' · Aircraft or departure changed; choose fuel again.':''}</p>}
      {canRequest&&f.canOrder&&f.profile&&<div className="flight-actions">
        {f.request?.status!=='COMPLETED'&&<button onClick={()=>setEditing(editing===f.id?null:f.id)}>{f.request?'Edit fuel':'Request fuel'}</button>}
        {f.request?.status==='PENDING'&&<button disabled={busy===f.id} onClick={()=>void cancel(f)}>Cancel request</button>}
      </div>}
      {editing===f.id&&f.profile&&<FuelForm flight={f} onChanged={()=>setReload(n=>n+1)} onClose={()=>setEditing(null)} />}
    </li>)}</ul>
  </section>;
}
