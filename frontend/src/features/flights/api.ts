export type FuelRequest={id:string;status:'PENDING'|'COMPLETED'|'CANCELLED'|'NEEDS_REVIEW';requestKind:'PRESET'|'QUANTITY';presetLabel:string|null;
  quantityValue:number|null;quantityUnit:'L'|'US_GAL'|null;reviewReason:string|null;completedAt:string|null;appliesToCurrentAircraft:boolean};
export type Flight={id:string;bookingType:string;startsAt:string;endsAt:string;flightStartsAt:string|null;flightEndsAt:string|null;status:string;
  aircraft:{id:string;callSign:string|null;model:string|null;aircraftClass:string|null}|null;
  departureAirport:{id:string;name:string|null}|null;arrivalAirport:{id:string;name:string|null}|null;
  instructor:string|null;canOrder:boolean;profile:{id:string;name:string;presets:{key:string;label:string}[]}|null;request:FuelRequest|null};
export type FlightsData={from:string;to:string;timeZone:'Europe/Oslo';sync:{lastSyncedAt:string;stale:boolean;warning:string|null};flights:Flight[]};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
async function response(res:Response){const data:unknown=await res.json().catch(()=>null);
  if(res.status===401||res.redirected)throw new Error('Your Access session may have expired. Reload to sign in again.');
  if(!res.ok)throw new Error(object(data)&&typeof data.error==='string'?data.error:'Flights could not be loaded.');
  return data;}
export async function loadFlights(signal:AbortSignal):Promise<FlightsData>{
  const res=await fetch('/api/flights',{signal,credentials:'same-origin',cache:'no-store'});
  const data=await response(res);
  if(!object(data)||!Array.isArray(data.flights)||!object(data.sync)||data.timeZone!=='Europe/Oslo')throw new Error('Flights returned an unexpected response.');
  return data as FlightsData;
}
export type FuelChoice={kind:'PRESET';presetKey:string}|{kind:'QUANTITY';quantityValue:number;quantityUnit:'L'|'US_GAL'};
export async function changeFuel(flightId:string,method:'POST'|'PUT'|'DELETE',choice?:FuelChoice){
  const res=await fetch(`/api/flights/${encodeURIComponent(flightId)}/fuel`,{method,credentials:'same-origin',cache:'no-store',
    headers:choice?{'Content-Type':'application/json'}:undefined,body:choice?JSON.stringify(choice):undefined});
  return response(res);
}
