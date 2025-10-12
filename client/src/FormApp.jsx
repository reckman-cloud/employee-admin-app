// client/src/FormApp.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import UserBadge from './security/UserBadge.jsx';

const API = { lists: '/api/lists', submitAll: '/api/submit-all', health: '/api/health' };
const STORAGE_KEY = 'emp_entries_v1';
const uuid = () => crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((c==='x'? (Math.random()*16|0) : ((Math.random()*16|0)&0x3|0x8))).toString(16));

function useLocalStorage(key, initial){ const [s, setS] = useState(()=>{ try{const v=localStorage.getItem(key); return v?JSON.parse(v):initial;}catch{return initial;} }); useEffect(()=>{ localStorage.setItem(key, JSON.stringify(s)); }, [key,s]); return [s,setS]; }
function HealthBadge(){ const [st,setSt]=useState({cls:'checking',text:'Checking…'}); const ref=useRef(null);
  const check=async()=>{ ref.current?.abort(); const ac=new AbortController(); ref.current=ac; setSt({cls:'checking',text:'Checking…'}); const t=setTimeout(()=>ac.abort('timeout'),8000);
    try{ const r=await fetch(API.health,{signal:ac.signal}); const d=await r.json().catch(()=>null); if(!r.ok){ setSt({cls:'error',text:'Error'}); return;} if(!d?.ok){ setSt({cls:'warn',text:'Degraded'}); return;}
      const label=d?.queue?.name?`OK · ${d.queue.name}${Number.isFinite(d.queue.approximateMessagesCount)?` (~${d.queue.approximateMessagesCount})`:''}`:'OK'; setSt({cls:'ok',text:label}); }
    catch{ setSt({cls:navigator.onLine?'error':'offline',text:navigator.onLine?'Error':'Offline'});} finally{ clearTimeout(t);} };
  useEffect(()=>{ check(); const id=setInterval(()=>{ if(!document.hidden) check(); },30000); return()=>{ clearInterval(id); ref.current?.abort(); }; }, []);
  return (<div className={`health ${st.cls}`} role="status" aria-live="polite" title="Queue health"><span className="dot" aria-hidden="true"></span><span style={{fontSize:12,color:'#9196a1'}}>{st.text}</span><button className="ghost small" type="button" onClick={check}>↻</button></div>);
}
function ManagerComboBox({ managers, value, onSelect, error }){ const [q,setQ]=useState(value?.name||''); const [open,setOpen]=useState(false); const [active,setActive]=useState(-1);
  const items=React.useMemo(()=>{ const s=q.trim().toLowerCase(); if(!s) return managers.slice(0,8);
    const score=m=>{ const n=m.name.toLowerCase(), t=(m.title||'').toLowerCase(), d=(m.department||'').toLowerCase(), u=(m.upn||'').toLowerCase(); let sc=0; if(n.startsWith(s)) sc+=3; if(n.includes(s)) sc+=2; if(u.includes(s)) sc+=2; if(t.includes(s)) sc+=1; if(d.includes(s)) sc+=1; return sc; };
    return managers.map(m=>[score(m),m]).filter(([sc])=>sc>0).sort((a,b)=>b[0]-a[0]).map(([,m])=>m).slice(0,8); },[q,managers]);
  React.useEffect(()=>{ setQ(value?.name||''); },[value]); const choose=m=>{ onSelect(m); setQ(m.name); setOpen(false); };
  const onKey=e=>{ if(e.key==='ArrowDown'){e.preventDefault(); setOpen(true); setActive(a=>Math.min(items.length-1,a+1));}
    else if(e.key==='ArrowUp'){e.preventDefault(); setActive(a=>Math.max(0,a-1));}
    else if(e.key==='Enter'&&open&&active>=0){e.preventDefault(); choose(items[active]);}
    else if(e.key==='Escape'){setOpen(false);} };
  return (<div className="field" aria-describedby="manager-err"><label htmlFor="manager">Manager <span className="muted">• required</span></label>
    <div className="combo" role="combobox" aria-haspopup="listbox" aria-expanded={open}>
      <input id="manager" name="manager" type="text" autoComplete="off" aria-controls="manager-listbox" aria-autocomplete="list"
        value={q} onChange={e=>{ setQ(e.target.value); onSelect(null); setOpen(true); }} onKeyDown={onKey} onBlur={()=> setTimeout(()=>setOpen(false),120)} className={error?'error':''}/>
      {!open?null:(<ul id="manager-listbox" className="listbox" role="listbox">
        {items.length?items.map((m,i)=>(<li key={m.id} className={`option ${i===active?'active':''}`} role="option" onMouseDown={e=>{ e.preventDefault(); choose(m); }}>
          <strong>{m.name}</strong><span className="opt-sub">{m.title} · {m.department}{m.upn?` · ${m.upn}`:''}</span></li>)): <div className="nores" role="note" style={{padding:'8px 10px', color:'#a6abb6'}}>No results</div>}
      </ul>)}
    </div><div id="manager-err" className="err" aria-live="polite">{error||''}</div></div>);
}
function EntriesTable({ entries, onEdit, onDelete }){ if(!entries.length) return <div className="muted" id="empty-state">No entries yet. Submit the form to see items here.</div>;
  return (<div id="entries-wrap"><table aria-describedby="entries-count"><thead>
    <tr><th>First</th><th>Last</th><th>Title</th><th>Department</th><th>Business Unit</th><th>Full Time</th><th>Manager</th><th style={{width:180}}>Actions</th></tr></thead>
    <tbody>{entries.map(e=> (<tr key={e.id}>
      <td>{e.firstName}</td><td>{e.lastName}</td><td>{e.title}</td><td>{e.department}</td>
      <td><span className="chip">{e.businessUnit}</span></td>
      <td><span className="chip">{e.fullTime ? 'Yes' : 'No'}</span></td>
      <td><span className="chip">{e.managerName || e.managerUpn || e.managerId}</span></td>
      <td><button type="button" onClick={()=>onEdit(e.id)}>Edit</button>{' '}<button type="button" onClick={()=>onDelete(e.id)}>Delete</button></td></tr>))}</tbody></table></div>);
}
export default function FormApp(){
  const [lists, setLists] = useState({ departments: [], businessUnits: [], managers: [] });
  const [form, setForm] = useState({ id:null, firstName:'', lastName:'', title:'', department:'', businessUnit:'', managerId:'', managerUpn:'', managerName:'', fullTime:true });
  const [errors, setErrors] = useState({});
  const [entries, setEntries] = useLocalStorage(STORAGE_KEY, []);
  const [toast, setToast] = useState('');
  const unsubmitted = useMemo(()=> entries.filter(e=>!e._meta?.submittedAt).length, [entries]);
  const showToast = (m)=>{ setToast(m); setTimeout(()=>setToast(''),1600); };

  useEffect(()=>{ let alive=true; (async()=>{ try{ const r=await fetch(API.lists,{cache:'no-store'}); const d=await r.json(); if(!r.ok) throw new Error(); if(!alive) return;
      setLists({ departments:d.departments||[], businessUnits:d.businessUnits||[], managers:d.managers||[] }); } catch { setLists({departments:[],businessUnits:[],managers:[]}); } })(); return ()=>{ alive=false; }; }, []);
  const setField=(k,v)=> setForm(f=>({...f,[k]:v}));
  const validate=()=>{ const e={}; if(!form.firstName||form.firstName.trim().length<2) e.firstName='First name is required';
    if(!form.lastName||form.lastName.trim().length<2) e.lastName='Last name is required'; if(!form.title||form.title.trim().length<2) e.title='Title is required';
    if(!form.department) e.department='Department is required'; if(!form.businessUnit) e.businessUnit='Business Unit is required'; if(!form.managerId) e.manager='Select a manager from the list'; setErrors(e); return !Object.keys(e).length; };
  const resetForm=()=>{ setForm({ id:null, firstName:'', lastName:'', title:'', department:'', businessUnit:'', managerId:'', managerUpn:'', managerName:'', fullTime:true }); setErrors({}); };
  const saveEntry=e=>{ e.preventDefault(); if(!validate()) return; const now=new Date().toISOString();
    setEntries(prev=> form.id? prev.map(x=> x.id===form.id? {...form,_meta:{...(x._meta||{}),savedAt:now,schema:3}}:x)
                             : [...prev, {...form,id:uuid(),_meta:{savedAt:now,submittedAt:null,schema:3}}]); resetForm(); showToast('Saved.'); };
  const editEntry=id=>{ const x=entries.find(e=>e.id===id); if(!x) return; setForm({ id:x.id, firstName:x.firstName, lastName:x.lastName, title:x.title, department:x.department, businessUnit:x.businessUnit, managerId:x.managerId, managerUpn:x.managerUpn||'', managerName:x.managerName||'', fullTime: typeof x.fullTime==='boolean'?x.fullTime:true }); };
  const deleteEntry=id=> setEntries(prev=> prev.filter(x=> x.id!==id));
  const clearAll=()=>{ if(!entries.length) return; if(confirm('Clear ALL saved entries?')) setEntries([]); };

  const buildPayload = (listManagers, items) => items.map((e) => {
    const { managerName, ...rest } = e;
    if (!rest.managerUpn && rest.managerId) {
      const m = listManagers.find(m => m.id === rest.managerId);
      if (m?.upn) rest.managerUpn = m.upn;
    }
    if (typeof rest.fullTime !== 'boolean') rest.fullTime = true;
    return rest;
  });

  const exportJSON=()=>{ const payload = buildPayload(lists.managers, entries);
    const b=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=`employees-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href); };

  const submitAll=async()=>{ const toSubmit=entries; if(!toSubmit.length){ showToast('Nothing to submit.'); return; }
    const payloadEntries = buildPayload(lists.managers, toSubmit);
    const r=await fetch(API.submitAll,{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ entries: payloadEntries }) });
    const d=await r.json().catch(()=>({})); if(!r.ok){ showToast('Submit failed.'); return; }
    const acceptedIds=new Set((d.accepted||[]).map(x=>x.id)); const failed=(d.failed||[]);
    setEntries(prev=> prev.filter(e=> !acceptedIds.has(e.id)));
    const ok=acceptedIds.size, fail=failed.length; showToast(fail?`Submitted ${ok}, ${fail} failed.`:`Submitted ${ok} and cleared.`); };

  return (
    <>
      <UserBadge />
      <main>
        <section className="card" aria-labelledby="form-title">
          <h1 id="form-title">New Employee Input Form</h1>
          <p className="muted">All fields required.</p>
          <form onSubmit={saveEntry} onReset={resetForm} noValidate>
            <div className="row">
              <div className="field half"><label htmlFor="firstName">First name <span className="muted">• required</span></label>
                <input id="firstName" value={form.firstName} onChange={e=>setField('firstName',e.target.value)} className={errors.firstName?'error':''}/>
                <div className="err">{errors.firstName||''}</div></div>
              <div className="field half"><label htmlFor="lastName">Last name <span className="muted">• required</span></label>
                <input id="lastName" value={form.lastName} onChange={e=>setField('lastName',e.target.value)} className={errors.lastName?'error':''}/>
                <div className="err">{errors.lastName||''}</div></div>
              <div className="field half"><label htmlFor="title">Title <span className="muted">• required</span></label>
                <input id="title" value={form.title} onChange={e=>setField('title',e.target.value)} className={errors.title?'error':''}/>
                <div className="err">{errors.title||''}</div></div>
              <div className="field half"><label htmlFor="department">Department <span className="muted">• required</span></label>
                <select id="department" value={form.department} onChange={e=>setField('department',e.target.value)} className={errors.department?'error':''}>
                  <option value="">Select…</option>{lists.departments.map(d=> <option key={d} value={d}>{d}</option>)}
                </select><div className="err">{errors.department||''}</div></div>
              <div className="field half"><label htmlFor="businessUnit">Business Unit <span className="muted">• required</span></label>
                <select id="businessUnit" value={form.businessUnit} onChange={e=>setField('businessUnit',e.target.value)} className={errors.businessUnit?'error':''}>
                  <option value="">Select…</option>{lists.businessUnits.map(b=> <option key={b} value={b}>{b}</option>)}
                </select><div className="err">{errors.businessUnit||''}</div></div>
              <div className="field half"><label htmlFor="fullTime">Full time</label>
                <input id="fullTime" type="checkbox" checked={form.fullTime} onChange={(e)=>setField('fullTime', e.target.checked)} aria-describedby="fullTime-help"/>
                <div id="fullTime-help" className="err" aria-live="polite"></div></div>
              <ManagerComboBox managers={lists.managers} value={form.managerId?{id:form.managerId,name:form.managerName}:null}
                onSelect={m=> m? setForm(f=>({...f,managerId:m.id,managerUpn:m.upn||'',managerName:m.name})) : setForm(f=>({...f,managerId:'',managerUpn:'',managerName:''}))} error={errors.manager}/>
            </div>
            <div className="toolbar" style={{marginTop:10}}>
              <button className="primary" type="submit" disabled={!lists.managers.length}>Save Entry</button>
              <button className="ghost" type="reset">Reset</button>
              <button type="button" onClick={exportJSON}>Export JSON</button>
            </div>
            <div className={`toast ${toast?'show':''}`} role="status" aria-live="polite">{toast||''}</div>
          </form>
        </section>

        <aside className="card" aria-labelledby="preview-title">
          <h2 id="preview-title">Live Preview (JSON)</h2>
          <pre className="kvs" style={{whiteSpace:'pre-wrap'}} aria-live="polite">{JSON.stringify(form, null, 2)}</pre>
        </aside>

        <section className="card" style={{gridColumn:'1 / -1'}} aria-labelledby="entries-title">
          <div className="toolbar">
            <h2 id="entries-title" style={{margin:0}}>Saved Entries</h2>
            <span className="muted" id="entries-count">{entries.length?`(${entries.length})`:''}</span>
            <span style={{flex:1}}/>
            <HealthBadge/>
            <button type="button" className="primary" onClick={submitAll} disabled={!entries.length || !unsubmitted}>Submit All{unsubmitted?` (${unsubmitted})`:''}</button>
            <button type="button" className="ghost" onClick={clearAll}>Clear All</button>
          </div>
          <EntriesTable entries={entries} onEdit={id=>{ const e = entries.find(x=>x.id===id); if(!e) return; setForm({ id:e.id, firstName:e.firstName, lastName:e.lastName, title:e.title, department:e.department, businessUnit:e.businessUnit, managerId:e.managerId, managerUpn:e.managerUpn||'', managerName:e.managerName||'', fullTime: typeof e.fullTime==='boolean'?e.fullTime:true }); }} onDelete={id=>setEntries(prev=>prev.filter(x=>x.id!==id))}/>
        </section>
      </main>
    </>
  );
}
