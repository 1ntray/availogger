export type ContactThread = {id:string;channelId:string;category:string;title:string;currentPath:string|null;status:'OPEN'|'RESOLVED';createdAt:string;updatedAt:string;resolvedAt:string|null;author:{id:string;firstName:string|null;lastName:string|null;email:string}};
export type ContactMessage = {id:string;body:string;createdAt:string;author:{id:string;firstName:string|null;lastName:string|null}};
export type InboxItem = {id:string;kind:string;sourceType:string;createdAt:string;readAt:string|null;title:string;summary:string|null;target:{path:string;flightId?:string;exchangeId?:string}|null;flight:unknown;changes:unknown[]};
async function request<T>(path:string,method='GET',body?:object,signal?:AbortSignal):Promise<T>{
  let response:Response;try{response=await fetch(path,{method,signal,credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});}
  catch(error){if(signal?.aborted)throw error;throw new Error('Could not reach the portal. Check your connection.');}
  const data:unknown=await response.json().catch(()=>null);
  if(response.status===401||response.redirected)throw new Error('Your session may have expired. Reload to sign in again.');
  if(!response.ok)throw new Error(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'?data.error:'Could not load or save this message.');
  return data as T;
}
export const contactApi={
  list:(admin=false,status?:string,cursor?:string,signal?:AbortSignal)=>request<{threads:ContactThread[];nextCursor:string|null}>(`${admin?'/api/admin/contact':'/api/contact'}?${new URLSearchParams({...status?{status}:{},...cursor?{cursor}:{}})}`, 'GET',undefined,signal),
  detail:(id:string,admin=false,signal?:AbortSignal)=>request<{thread:ContactThread;messages:ContactMessage[];hasMore:boolean}>(`${admin?'/api/admin/contact':'/api/contact'}/${id}`,'GET',undefined,signal),
  create:(category:string,body:string,currentPath:string|null)=>request<{id:string;title:string}>('/api/contact','POST',{category,body,currentPath}),
  reply:(id:string,body:string,admin=false)=>request<{id:string;createdAt:string}>(`${admin?'/api/admin/contact':'/api/contact'}/${id}/reply`,'POST',{body}),
  status:(id:string,status:'OPEN'|'RESOLVED')=>request<{status:string}>(`/api/admin/contact/${id}/status`,'POST',{status}),
  inbox:(cursor?:string,signal?:AbortSignal)=>request<{items:InboxItem[];unreadCount:number;nextCursor:string|null}>(`/api/inbox${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,'GET',undefined,signal),
  read:(id:string)=>request<{id:string;readAt:string}>(`/api/inbox/${id}/read`,'POST'),
};
