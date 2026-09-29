import { useEffect,useState } from 'react';
import { useParams } from 'react-router';
import { completeFuel,loadShiftTasks,type FuelTask,type ShiftTasks } from '../features/flights/task-api';
import { loadDutyOps } from '../features/duty-ops/api';
import type { DutyOpsData } from '../features/duty-ops/types';
import { DutyExchanges, ExchangeShiftActions } from '../features/duty-ops/DutyExchanges';
import { ExchangeV2Provider } from '../features/exchange/ExchangeV2';
import { useCurrentUser } from '../app/CurrentUser';
import { dateLabel, participantLabel, timeLabel } from '../features/duty-ops/presentation';
import { AttentionDetail } from '../app/AttentionDetail';
import { ActionButton, BackLink, PageHeader, RefreshControl } from '../app/controls';
import { osloDate } from '../dates';
import '../features/flights/flights.css';
import '../features/duty-ops/duty-ops.css';

const date=(value:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
const clock=(value:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Oslo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
function TaskList({tasks,now,onComplete,busy}:{tasks:FuelTask[];now:number;onComplete:(id:string)=>void;busy:string|null}){
  return <ul className="fuel-task-list">{tasks.map(task=><li key={task.id} className={`fuel-task-row ${Date.parse(task.attentionFrom)<=now?'is-due':''}`}>
    <div className="fuel-task-head"><strong><time dateTime={task.flightStartsAt}>{date(task.flightStartsAt)}</time></strong>
      <span>{task.aircraft.callSign??'Aircraft'}{task.aircraft.model?` · ${task.aircraft.model}`:''}</span></div>
    <p className="fuel-meta">{task.requested} · {task.pilot}</p>
    {task.fuelBreakdown&&<dl className="fuel-task-breakdown"><div><dt>Total fuel</dt><dd>{task.fuelBreakdown.total} L</dd></div>
      <div><dt>Mains</dt><dd>{task.fuelBreakdown.mains} L</dd></div>
      <div><dt>Aux total</dt><dd>{task.fuelBreakdown.auxTotal} L</dd></div>
      <div><dt>Each aux</dt><dd>{task.fuelBreakdown.eachAux} L</dd></div></dl>}
    {task.earlierFlight&&<p className="fuel-meta">Known earlier flight expected back {date(task.earlierFlight.endsAt)}
      {task.earlierFlight.timeSource==='booking'?' (booking end)':''}{task.earlierFlight.pilot?` · ${task.earlierFlight.pilot}`:''}.
      Partial linked schedule; confirm actual aircraft availability.</p>}
    {Date.parse(task.attentionFrom)>now&&<p className="fuel-meta">Due from {date(task.attentionFrom)}</p>}
    <ActionButton variant="primary" disabled={busy===task.id} onClick={()=>onComplete(task.id)}>Complete</ActionButton>
  </li>)}</ul>;
}
export function DutyShiftPage(){const {shiftId}=useParams();const [data,setData]=useState<ShiftTasks|null>(null),[error,setError]=useState(''),
  [loading,setLoading]=useState(true),[reload,setReload]=useState(0),[busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState('');
  const { user } = useCurrentUser();
  const [schedule, setSchedule] = useState<DutyOpsData | null>(null);
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{if(!shiftId)return;const controller=new AbortController();setLoading(true);setError('');
    loadShiftTasks(shiftId,controller.signal).then(setData).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load shift tasks.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[shiftId,reload]);
  useEffect(() => {
    const controller = new AbortController();
    void loadDutyOps(controller.signal).then(setSchedule).catch(() => {});
    return () => controller.abort();
  }, [user?.subject, reload]);
  const complete=async(id:string)=>{if(!shiftId)return;setBusy(id);setError('');try{const done=await completeFuel(shiftId,id);
    setNotice(`✓ Completed ${date(done.completedAt)} by ${done.completedBy}.`);setReload(n=>n+1);}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not complete the request.');}finally{setBusy(null);}};
  const due=data?.tasks.filter(t=>Date.parse(t.attentionFrom)<=now)??[],later=data?.tasks.filter(t=>Date.parse(t.attentionFrom)>now)??[];
  const shift = schedule?.shifts.find(item => item.id === shiftId);
  const workspace = <section className="fuel-shift-page"><BackLink to="/duty-ops">Duty Ops</BackLink>
    <PageHeader title="Duty Ops shift"><RefreshControl label="Duty Ops shift" onRefresh={()=>setReload(n=>n+1)} loading={loading} retry={!!error} /></PageHeader>
    {data&&<p className="fuel-meta"><time dateTime={data.shift.startsAt}>{date(data.shift.startsAt)}</time>–<time dateTime={data.shift.endsAt}>{osloDate(new Date(data.shift.startsAt)) === osloDate(new Date(data.shift.endsAt)) ? clock(data.shift.endsAt) : date(data.shift.endsAt)}</time></p>}
    {shift && <><p className="fuel-meta">{participantLabel(shift)}</p>{shift.assignmentsDiffer && shift.flightlogger && <AttentionDetail label="Assignments differ from FlightLogger"><p>Studentportal is the current assignment. FlightLogger records: {participantLabel(shift.flightlogger)}</p></AttentionDetail>}</>}
    {shift && <ExchangeShiftActions shift={shift} />}
    {loading&&!data&&<p role="status">Loading shift tasks…</p>}{error&&<p className="fuel-error" role="alert">{error}</p>}
    {notice&&<p className="fuel-notice" role="status">{notice}</p>}
    {!loading&&data&&<section className="fuel-task-section"><h2>Fuel</h2>
      {!data.tasks.length&&<p className="fuel-notice">No pending fuel requests for this shift.</p>}
      {!!due.length&&<><h3>Due</h3><TaskList tasks={due} now={now} busy={busy} onComplete={id=>void complete(id)} /></>}
      {!!later.length&&<><h3>Later</h3><TaskList tasks={later} now={now} busy={busy} onComplete={id=>void complete(id)} /></>}
    </section>}
  </section>;
  return schedule && shift ? <ExchangeV2Provider domain="DUTY_OPS" assignments={schedule.shifts.map(item => ({
    id: item.id, label: `${dateLabel(item.startsAt)} · ${timeLabel(item)}`, ownerNames: participantLabel(item),
    own: item.participants.some(person => person.isCurrentUser),
  }))} refreshKey={reload} onChanged={() => setReload(n => n + 1)}>
    <DutyExchanges shifts={schedule.shifts} now={now} refreshKey={reload} onChanged={() => setReload(n => n + 1)} showBoard={false} legacyOnly>{workspace}</DutyExchanges>
  </ExchangeV2Provider> : workspace;
}
