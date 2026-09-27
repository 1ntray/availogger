import { useEffect,useState } from 'react';
import { Link,useParams } from 'react-router';
import { completeFuel,loadShiftTasks,type FuelTask,type ShiftTasks } from '../features/flights/task-api';
import '../features/flights/flights.css';

const date=(value:string)=>new Intl.DateTimeFormat('en',{timeZone:'Europe/Oslo',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
function TaskList({tasks,now,onComplete,busy}:{tasks:FuelTask[];now:number;onComplete:(id:string)=>void;busy:string|null}){
  return <ul className="fuel-task-list">{tasks.map(task=><li key={task.id} className={`fuel-task-row ${Date.parse(task.attentionFrom)<=now?'is-due':''}`}>
    <div className="fuel-task-head"><strong><time dateTime={task.flightStartsAt}>{date(task.flightStartsAt)}</time></strong>
      <span>{task.aircraft.callSign??'Aircraft'}{task.aircraft.model?` · ${task.aircraft.model}`:''}</span></div>
    <p className="fuel-meta">{task.requested} · {task.pilot}</p>
    {task.earlierFlight&&<p className="fuel-meta">Known earlier flight expected back {date(task.earlierFlight.endsAt)}
      {task.earlierFlight.timeSource==='booking'?' (booking end)':''}{task.earlierFlight.pilot?` · ${task.earlierFlight.pilot}`:''}.
      Partial linked schedule; confirm actual aircraft availability.</p>}
    {Date.parse(task.attentionFrom)>now&&<p className="fuel-meta">Due from {date(task.attentionFrom)}</p>}
    <button disabled={busy===task.id} onClick={()=>onComplete(task.id)}>Complete</button>
  </li>)}</ul>;
}
export function DutyShiftPage(){const {shiftId}=useParams();const [data,setData]=useState<ShiftTasks|null>(null),[error,setError]=useState(''),
  [loading,setLoading]=useState(true),[reload,setReload]=useState(0),[busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState('');
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{if(!shiftId)return;const controller=new AbortController();setLoading(true);setError('');
    loadShiftTasks(shiftId,controller.signal).then(setData).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load shift tasks.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[shiftId,reload]);
  const complete=async(id:string)=>{if(!shiftId)return;setBusy(id);setError('');try{const done=await completeFuel(shiftId,id);
    setNotice(`✓ Completed ${date(done.completedAt)} by ${done.completedBy}.`);setReload(n=>n+1);}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not complete the request.');}finally{setBusy(null);}};
  const due=data?.tasks.filter(t=>Date.parse(t.attentionFrom)<=now)??[],later=data?.tasks.filter(t=>Date.parse(t.attentionFrom)>now)??[];
  return <section className="fuel-shift-page"><Link className="action-link" to="/duty-ops">← Duty Ops</Link>
    <div className="fuel-shift-heading"><h1>Shift tasks</h1><button disabled={loading} onClick={()=>setReload(n=>n+1)}>Reload</button></div>
    {data&&<p className="fuel-meta">{date(data.shift.startsAt)}–{date(data.shift.endsAt)} · Europe/Oslo</p>}
    {loading&&<p role="status">Loading shift tasks…</p>}{error&&<p className="fuel-error" role="alert">{error}</p>}
    {notice&&<p className="fuel-notice" role="status">{notice}</p>}
    {!loading&&data&&<section className="fuel-task-section"><h2>Fuel</h2>
      {!data.tasks.length&&<p className="fuel-notice">No pending fuel requests for this shift.</p>}
      {!!due.length&&<><h3>Due</h3><TaskList tasks={due} now={now} busy={busy} onComplete={id=>void complete(id)} /></>}
      {!!later.length&&<><h3>Later</h3><TaskList tasks={later} now={now} busy={busy} onComplete={id=>void complete(id)} /></>}
    </section>}
  </section>;
}
