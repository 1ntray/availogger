const route=(domain:string)=>domain==='DUTY_OPS'?'/duty-ops':domain==='FLYVASK'?'/flyvask':'/flights';
const noun=(domain:string)=>domain==='DUTY_OPS'?'Duty Ops':domain==='FLYVASK'?'Flyvask':'flight';

export function scheduleGroupPresentation(row:{group_domain:string|null;group_count:number|null}){
  if(!row.group_domain||!row.group_count)return null;
  const domain=row.group_domain,count=row.group_count,label=noun(domain);
  const singular=domain==='FLIGHTS'?'New flight':`New ${label} assignment`;
  const plural=domain==='FLIGHTS'?`${count} new flights`:`${count} new ${label} assignments`;
  return {title:count===1?singular:plural,
    summary:domain==='FLIGHTS'?`${count} new ${count===1?'flight':'flights'} added to your schedule.`:
      `${count} new ${label} ${count===1?'assignment':'assignments'}.`,
    target:{path:route(domain)},flight:null,changes:[]};
}

export function scheduleChangePresentation(row:{schedule_domain:string|null;schedule_type:string|null}){
  if(!row.schedule_domain||!row.schedule_type)return null;
  const label=noun(row.schedule_domain);
  return {title:row.schedule_type==='REMOVED'?`${label} assignment removed`:`${label} time changed`,
    summary:row.schedule_type==='REMOVED'?`Removed from your ${label} schedule.`:`Your ${label} shift time changed.`,
    target:{path:route(row.schedule_domain)},flight:null,changes:[]};
}

export function contactNoticePresentation(row:{notice_type:string|null;notice_count:number|null;
  notice_thread_id:string|null;notice_title:string|null;notice_body:string|null;
  notice_author_first:string|null;notice_author_last:string|null}){
  if(!row.notice_type||!row.notice_thread_id||!row.notice_title)return null;
  const author=[row.notice_author_first,row.notice_author_last].filter(Boolean).join(' ')||'A student';
  const count=row.notice_count??1;
  const type=row.notice_type;
  const title=type==='NEW_FEEDBACK'?'New feedback':type==='STUDENT_REPLY'?'New reply to feedback':
    type==='WEBMASTER_REPLY'?'Reply to your feedback':type==='RESOLVED'?'Your feedback was resolved':'Your feedback was reopened';
  const summary=type==='NEW_FEEDBACK'?`${author} sent ${row.notice_title}.`:
    type==='STUDENT_REPLY'?`${author} replied to “${row.notice_title}”${count>1?` (${count} replies)`:''}.`:
    type==='WEBMASTER_REPLY'?`${count>1?`${count} replies`:'New reply'}: ${row.notice_title}.`:
    `“${row.notice_title}”`;
  return {title,summary:summary.slice(0,180),
    target:{path:type==='NEW_FEEDBACK'||type==='STUDENT_REPLY'?`/admin/contact/${row.notice_thread_id}`:
      `/messages/${row.notice_thread_id}`},flight:null,changes:[]};
}
