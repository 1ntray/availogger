import { methodNotAllowed, withAuthorizedUser } from '../../backend/application-api';
import { PERMISSIONS } from '../../shared/authorization';
import { getFlightLoggerCredential } from '../../backend/flightlogger-credentials';
import { loadFlights } from '../../backend/flights/service';
import { flightWindow } from '../../backend/flights/window';
import { json } from '../../backend/response';
import type { AccessData, PagesEnv } from '../../backend/env';

export const onRequest:PagesFunction<PagesEnv,string,AccessData>=context=>{
  if(context.request.method!=='GET')return methodNotAllowed('GET');
  return withAuthorizedUser(context,PERMISSIONS.flightsView,async(db,user)=>{
    const window=flightWindow(new URL(context.request.url));
    const token=await getFlightLoggerCredential(db,user.id,context.env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
    return json(await loadFlights(db,user,token,window));
  });
};
