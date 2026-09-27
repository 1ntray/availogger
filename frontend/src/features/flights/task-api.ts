export type FuelTask={id:string;flightId:string;flightStartsAt:string;attentionFrom:string;
  aircraft:{id:string;callSign:string|null;model:string|null};pilot:string;requested:string;status:'PENDING';
  earlierFlight:{endsAt:string;timeSource:'flight'|'booking';pilot:string|null}|null};
export type ShiftTasks={shift:{id:string;startsAt:string;endsAt:string};tasks:FuelTask[]};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
async function read(res:Response){const data:unknown=await res.json().catch(()=>null);
  if(res.status===401||res.redirected)throw new Error('Your Access session may have expired. Reload to sign in again.');
  if(!res.ok)throw new Error(object(data)&&typeof data.error==='string'?data.error:'Could not load shift tasks.');
  return data;}
export async function loadShiftTasks(shiftId:string,signal:AbortSignal):Promise<ShiftTasks>{
  const data=await read(await fetch(`/api/duty-ops/shifts/${encodeURIComponent(shiftId)}/tasks`,{signal,credentials:'same-origin',cache:'no-store'}));
  if(!object(data)||!object(data.shift)||!Array.isArray(data.tasks))throw new Error('Shift tasks returned an unexpected response.');
  return data as ShiftTasks;
}
export async function completeFuel(shiftId:string,requestId:string):Promise<{status:'COMPLETED';completedAt:string;completedBy:string}>{
  const data=await read(await fetch(`/api/duty-ops/shifts/${encodeURIComponent(shiftId)}/tasks/${encodeURIComponent(requestId)}/complete`,
    {method:'POST',credentials:'same-origin',cache:'no-store'}));
  if(!object(data)||data.status!=='COMPLETED'||typeof data.completedAt!=='string'||!Number.isFinite(Date.parse(data.completedAt))||
    typeof data.completedBy!=='string')throw new Error('Completion returned an unexpected response.');
  return data as {status:'COMPLETED';completedAt:string;completedBy:string};
}
