import { useEffect,useRef,useState,type FormEvent, type MouseEvent } from 'react';
import { Link,useLocation,useNavigate,useParams } from 'react-router';
import { ActionButton,BackLink,PageHeader,RefreshControl } from '../app/controls';
import { contactApi,type ContactThread,type ContactMessage,type InboxItem } from '../features/contact/api';

const categories=[['BUG','Bug'],['IMPROVEMENT','Improvement'],['IDEA','Idea'],['OTHER','Other']] as const;
const date=(value:string)=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Oslo'}).format(new Date(value));
const name=(person:{firstName:string|null;lastName:string|null;email?:string})=>[person.firstName,person.lastName].filter(Boolean).join(' ')||person.email||'Portal user';
const errorText=(cause:unknown)=>cause instanceof Error?cause.message:'Something went wrong. Try again.';

export function FeedbackPage(){
  const navigate=useNavigate(),location=useLocation();const [category,setCategory]=useState('BUG'),[body,setBody]=useState(''),[includePage,setIncludePage]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const from=(location.state as {from?:unknown}|null)?.from;
  const page=typeof from==='string'&&from.startsWith('/')&&!from.startsWith('//')?from:location.pathname;
  async function submit(event:FormEvent){event.preventDefault();if(saving)return;setSaving(true);setError('');try{const result=await contactApi.create(category,body,includePage?page:null);navigate(`/messages/${result.id}`,{replace:true});}catch(cause){setError(errorText(cause));}finally{setSaving(false);}}
  return <section className="contact-page"><PageHeader title="Send feedback"/><p className="contact-intro">Tell the webmaster about a bug, an improvement, or an idea. Your message stays in the portal.</p>
    <form className="contact-form" onSubmit={event=>void submit(event)}><label>Category<select value={category} onChange={event=>setCategory(event.target.value)}>{categories.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Message<textarea required maxLength={4000} rows={6} value={body} onChange={event=>setBody(event.target.value)} placeholder="What would you like us to know?"/></label>
      <label className="contact-check"><input type="checkbox" checked={includePage} onChange={event=>setIncludePage(event.target.checked)}/><span>Include current page <small>{page}</small></span></label>
      {error&&<p role="alert" className="contact-error">{error}</p>}<ActionButton type="submit" variant="primary" disabled={saving||!body.trim()}>{saving?'Sending…':'Send feedback'}</ActionButton>
    </form><p className="contact-help">Your account identifies you to the webmaster. Do not include passwords or other sensitive information.</p></section>;
}

export function ContactListPage({admin=false}:{admin?:boolean}){
  const [threads,setThreads]=useState<ContactThread[]>([]),[cursor,setCursor]=useState<string|null>(null),[status,setStatus]=useState<'OPEN'|'RESOLVED'>('OPEN'),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setThreads([]);void contactApi.list(admin,admin?status:undefined,undefined,controller.signal).then(data=>{if(!controller.signal.aborted){setThreads(data.threads);setCursor(data.nextCursor);}}).catch(cause=>{if(!controller.signal.aborted)setError(errorText(cause));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[admin,status,reload]);
  async function more(){if(!cursor||loading)return;setLoading(true);setError('');try{const data=await contactApi.list(admin,admin?status:undefined,cursor);setThreads(old=>[...old,...data.threads.filter(item=>!old.some(existing=>existing.id===item.id))]);setCursor(data.nextCursor);}catch(cause){setError(errorText(cause));}finally{setLoading(false);}}
  return <section className="contact-page"><PageHeader title={admin?'Contact messages':'My messages'}><RefreshControl label="messages" loading={loading} retry={!!error} onRefresh={()=>setReload(n=>n+1)}/></PageHeader>
    {!admin&&<Link className="action-link contact-new" to="/feedback">Send feedback →</Link>}
    {admin&&<div className="activity-filters" aria-label="Message status"><button aria-pressed={status==='OPEN'} onClick={()=>setStatus('OPEN')}>Open</button><button aria-pressed={status==='RESOLVED'} onClick={()=>setStatus('RESOLVED')}>Resolved</button></div>}
    {error&&<p role="alert" className="contact-error">{error}</p>}{loading&&threads.length===0&&<p role="status">Loading messages…</p>}
    <ul className="contact-list">{threads.map(thread=><li key={thread.id}><Link to={`${admin?'/admin/contact':'/messages'}/${thread.id}`}><span className="contact-list-main"><strong>{thread.title}</strong><small>{admin?name(thread.author):thread.channelId==='webmaster'?'Webmaster':thread.channelId}</small></span><span className="contact-list-meta"><span className={`contact-status contact-status--${thread.status.toLowerCase()}`}>{thread.status==='OPEN'?'Open':'Resolved'}</span><time dateTime={thread.updatedAt}>{date(thread.updatedAt)}</time></span></Link></li>)}</ul>
    {!loading&&!error&&threads.length===0&&<p>No {admin?status.toLowerCase()+' ':''}messages yet.</p>}{cursor&&<ActionButton onClick={()=>void more()} disabled={loading}>Load more</ActionButton>}</section>;
}

export function ContactDetailPage({admin=false}:{admin?:boolean}){
  const {threadId}=useParams(),[thread,setThread]=useState<ContactThread|null>(null),[messages,setMessages]=useState<ContactMessage[]>([]),[hasMore,setHasMore]=useState(false),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{if(!threadId)return;const controller=new AbortController();setError('');void contactApi.detail(threadId,admin,controller.signal).then(data=>{if(!controller.signal.aborted){setThread(data.thread);setMessages(data.messages);setHasMore(data.hasMore);}}).catch(cause=>{if(!controller.signal.aborted)setError(errorText(cause));});return()=>controller.abort();},[threadId,admin,reload]);
  async function reply(event:FormEvent){event.preventDefault();if(!threadId||busy)return;setBusy(true);setError('');try{await contactApi.reply(threadId,body,admin);setBody('');setReload(n=>n+1);}catch(cause){setError(errorText(cause));}finally{setBusy(false);}}
  async function changeStatus(){if(!threadId||!thread||busy)return;setBusy(true);setError('');try{await contactApi.status(threadId,thread.status==='OPEN'?'RESOLVED':'OPEN');setReload(n=>n+1);}catch(cause){setError(errorText(cause));}finally{setBusy(false);}}
  return <section className="contact-page"><BackLink to={admin?'/admin/contact':'/messages'}>{admin?'Contact messages':'My messages'}</BackLink>
    {thread?<><PageHeader title={thread.title}><RefreshControl label="conversation" retry={!!error} onRefresh={()=>setReload(n=>n+1)}/></PageHeader>
      <div className="contact-context"><span className={`contact-status contact-status--${thread.status.toLowerCase()}`}>{thread.status==='OPEN'?'Open':'Resolved'}</span><span>From {name(thread.author)}{admin?` · ${thread.author.email}`:''}</span>{thread.currentPath&&<span>Page: {thread.currentPath}</span>}</div>
      <ol className="contact-conversation">{messages.map(message=><li key={message.id}><div><strong>{name(message.author)}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}</time></div><p>{message.body}</p></li>)}</ol>
      {hasMore&&<p>Older messages are not shown. Contact the webmaster if you need the complete conversation.</p>}
      <form className="contact-form" onSubmit={event=>void reply(event)}><label>Reply<textarea required maxLength={4000} rows={4} value={body} onChange={event=>setBody(event.target.value)}/></label>
        {error&&<p role="alert" className="contact-error">{error}</p>}<div className="contact-actions"><ActionButton type="submit" variant="primary" disabled={busy||!body.trim()}>{busy?'Saving…':'Send reply'}</ActionButton>{admin&&<ActionButton disabled={busy} onClick={()=>void changeStatus()}>{thread.status==='OPEN'?'Mark resolved':'Reopen'}</ActionButton>}</div></form></>:error?<p role="alert" className="contact-error">{error}</p>:<p role="status">Loading conversation…</p>}</section>;
}

export function InboxPage(){
  const navigate=useNavigate(),pendingReads=useRef(new Map<string,Promise<void>>());
  const [items,setItems]=useState<InboxItem[]>([]),[cursor,setCursor]=useState<string|null>(null),[unread,setUnread]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');void contactApi.inbox(undefined,controller.signal).then(data=>{if(!controller.signal.aborted){setItems(data.items);setCursor(data.nextCursor);setUnread(data.unreadCount);}}).catch(cause=>{if(!controller.signal.aborted)setError(errorText(cause));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[reload]);
  function mark(item:InboxItem){
    if(item.readAt)return Promise.resolve();
    const pending=pendingReads.current.get(item.id);if(pending)return pending;
    const work=contactApi.read(item.id).then(data=>{
      setItems(old=>old.map(value=>value.id===item.id?{...value,readAt:data.readAt}:value));
      setUnread(n=>Math.max(0,n-1));window.dispatchEvent(new Event('portal-inbox-changed'));
    }).catch(cause=>{setError(errorText(cause));}).finally(()=>{pendingReads.current.delete(item.id);});
    pendingReads.current.set(item.id,work);return work;
  }
  async function open(event:MouseEvent<HTMLAnchorElement>,item:InboxItem){
    event.preventDefault();
    if(!item.target)return;
    // Wait for a normal read response, but let a slow API call finish after
    // client-side navigation rather than trapping the student in Inbox.
    let timer:number|undefined;
    await Promise.race([mark(item),new Promise<void>(resolve=>{timer=window.setTimeout(resolve,2000);})]);
    if(timer!==undefined)window.clearTimeout(timer);
    navigate(item.target.path);
  }
  async function more(){if(!cursor||loading)return;setLoading(true);try{const data=await contactApi.inbox(cursor);setItems(old=>[...old,...data.items.filter(item=>!old.some(existing=>existing.id===item.id))]);setCursor(data.nextCursor);setUnread(data.unreadCount);}catch(cause){setError(errorText(cause));}finally{setLoading(false);}}
  return <section className="contact-page"><PageHeader title="Inbox"><RefreshControl label="Inbox" loading={loading} retry={!!error} onRefresh={()=>setReload(n=>n+1)}/></PageHeader><p className="contact-intro">{unread} unread. Inbox read status is separate from the source item itself.</p>
    {error&&<p role="alert" className="contact-error">{error}</p>}{loading&&items.length===0&&<p role="status">Loading Inbox…</p>}
    <ul className="contact-list inbox-list">{items.map(item=><li key={item.id} className={item.readAt?'':'unread'}><div><span className="contact-list-main"><strong>{item.title}</strong>{item.summary&&<small>{item.summary}</small>}</span><span className="contact-list-meta"><time dateTime={item.createdAt}>{date(item.createdAt)}</time>{!item.readAt&&<span className="contact-unread">Unread</span>}</span></div><div className="inbox-actions">{item.target&&<Link to={item.target.path} onClick={event=>void open(event,item)}>Open</Link>}{!item.readAt&&<button type="button" onClick={()=>void mark(item)}>Mark read</button>}</div></li>)}</ul>
    {!loading&&!error&&!items.length&&<p>Your Inbox is empty.</p>}{cursor&&<ActionButton onClick={()=>void more()} disabled={loading}>Load more</ActionButton>}</section>;
}
