import { methodNotAllowed, withAuthorizedUser } from '../application-api';
import { ApplicationError } from '../application-error';
import type { AccessData, PagesEnv } from '../env';
import { getFlightLoggerCredential } from '../flightlogger-credentials';
import { json } from '../response';
import { requireSameOrigin } from '../same-origin';
import { PERMISSIONS } from '../../shared/authorization';
import { cancelFuel, completeFuel, createFuel, fuelId, shiftTasks, updateFuel, type FuelChoice } from './fuel';
import { loadFlights } from './service';
import { flightWindow } from './window';

type Context={request:Request;env:PagesEnv;data:AccessData;params:Record<string,string|string[]>};
const bad=()=>new ApplicationError('Submit a valid fuel request.',400,'INVALID_FUEL_REQUEST');
async function body(request:Request):Promise<FuelChoice>{
  requireSameOrigin(request);
  if(new URL(request.url).search)throw bad();
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    throw new ApplicationError('Submit fuel changes as JSON.',415);
  const reader=request.body?.getReader();if(!reader)throw bad();
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;
    if(length>1024){await reader.cancel();throw new ApplicationError('Fuel request is too large.',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
  let data:unknown;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw bad();}
  if(!data||typeof data!=='object'||Array.isArray(data))throw bad();
  const value=data as Record<string,unknown>,keys=Object.keys(value).sort().join(',');
  if(value.kind==='PRESET'&&keys==='kind,presetKey'&&typeof value.presetKey==='string'&&/^[A-Z_]{2,40}$/.test(value.presetKey))
    return {kind:'PRESET',presetKey:value.presetKey};
  if(value.kind==='QUANTITY'&&keys==='kind,quantityUnit,quantityValue'&&typeof value.quantityValue==='number'&&
    Number.isFinite(value.quantityValue)&&value.quantityValue>0&&value.quantityValue<=1000&&
    (value.quantityUnit==='L'||value.quantityUnit==='US_GAL'))return value as FuelChoice;
  throw bad();
}
function emptyMutation(request:Request){requireSameOrigin(request);if(new URL(request.url).search)throw bad();
  if(request.body!==null || request.headers.get('Content-Length') && Number(request.headers.get('Content-Length'))>0)throw bad();}
export function fuelEndpoint(context:Context):Promise<Response>|Response {
  const method=context.request.method;
  if(!['POST','PUT','DELETE'].includes(method))return methodNotAllowed('POST, PUT, DELETE');
  return withAuthorizedUser(context,PERMISSIONS.fuelRequest,async(db,user)=>{
    const id=fuelId(context.params.flightId);
    if(method==='DELETE'){emptyMutation(context.request);return json(await cancelFuel(db,user,id));}
    const submitted=await body(context.request);
    const token=await getFlightLoggerCredential(db,user.id,context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
    const response=await loadFlights(db,user,token,flightWindow(new URL(context.request.url)),15);
    if(response.sync.stale)throw new ApplicationError('Refresh flights before requesting fuel.',503);
    if(!response.flights.some(f=>f.id===id))throw new ApplicationError('Flight not found in your current schedule.',404);
    return json(method==='POST'?await createFuel(db,user,id,submitted):await updateFuel(db,user,id,submitted),method==='POST'?201:200);
  });
}
export function shiftTasksEndpoint(context:Context):Promise<Response>|Response {
  if(context.request.method!=='GET')return methodNotAllowed('GET');
  return withAuthorizedUser(context,PERMISSIONS.dutyOpsView,async(db,user)=>{
    if(new URL(context.request.url).search)throw bad();
    return json(await shiftTasks(db,user,fuelId(context.params.shiftId)));
  });
}
export function completeFuelEndpoint(context:Context):Promise<Response>|Response {
  if(context.request.method!=='POST')return methodNotAllowed('POST');
  return withAuthorizedUser(context,PERMISSIONS.dutyOpsView,async(db,user)=>{
    emptyMutation(context.request);
    return json(await completeFuel(db,user,fuelId(context.params.shiftId),fuelId(context.params.requestId)));
  });
}
