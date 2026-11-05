import {HISTORY_API,COURSE_HISTORY_API,COURSE_HISTORY_KEY} from './history-config.js';
const root=document.querySelector('#learningHistory');
const $=s=>root.querySelector(s);
const AREAS={all:'전체',phonics:'파닉스',vocabulary:'단어장',newspaper:'영자신문',newsdesk:'고래뉴스데스크',grammar:'문법',school:'중등·고등'};
const state={records:[],area:'all',activity:'all',learner:'',view:'rankings',limit:20,request:0,controller:null,archive:null,sources:[]};
const kst=d=>new Date(d.getTime()+9*3600000);
const today=()=>kst(new Date());
const dateLabel=at=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
const dateKey=at=>kst(new Date(at)).toISOString().slice(0,10);
export function sanitizeRecord(r){
 if(!r||!['phonics','vocabulary','newspaper','newsdesk','grammar','school'].includes(r.area)||!r.id||!r.learner||!r.unique||!Number.isFinite(Date.parse(r.at)))return null;
 const raw=String(r.student??'').replace(/\s+/g,'');const chars=Array.from(raw);
 const student=/[○◯*]/.test(raw)?raw.replace(/[◯*]/g,'○'):chars.length<2?'○':chars[0]+'○'.repeat(Math.max(1,chars.length-2))+(chars.length>2?chars.at(-1):'');
 return {id:String(r.id),learner:String(r.learner),unique:String(r.unique),student,area:r.area,at:new Date(r.at).toISOString(),activity:String(r.activity??''),course:String(r.course??''),unit:String(r.unit??'')};
}
export function rankRecords(records){
 const groups=new Map();
 for(const r of records){const key=r.learner;let group=groups.get(key);if(!group){group={student:r.student,learner:r.learner,keys:new Set()};groups.set(key,group)}
  // Repeating the same item in a period counts once. DRILL's daily completed SET is retained.
  group.keys.add(r.unique+(r.activity==='단어 DRILL'?':'+dateKey(r.at):''));
 }
 const rows=[...groups.values()].map(r=>({...r,count:r.keys.size})).sort((a,b)=>b.count-a.count||a.student.localeCompare(b.student,'ko')||a.learner.localeCompare(b.learner));
 let rank=0,last=-1;return rows.map(r=>{if(r.count!==last){rank++;last=r.count}return {...r,rank}});
}
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
function period(){return {year:$('#historyYear').value,month:$('#historyMonth').value}}
function matchesPeriod(r,p){const d=kst(new Date(r.at));return d.getUTCFullYear()===Number(p.year)&&(p.month==='all'||d.getUTCMonth()+1===Number(p.month))}
function selection(){return state.records.filter(r=>(state.area==='all'||r.area===state.area)&&(state.activity==='all'||r.activity===state.activity)&&(!state.learner||r.learner===state.learner)&&(!$('#historySearch').value.trim()||[r.student,r.course,r.unit,r.activity].some(t=>t.toLowerCase().includes($('#historySearch').value.trim().toLowerCase()))))}
function render(){
 const records=selection(),activities=[...new Set(records.map(r=>r.activity))];
 $('#historyCount').textContent=records.length.toLocaleString('ko-KR');
 $('#historyKinds').textContent=activities.length;
 $('#historyResetStudent').hidden=!state.learner;
 $('#historyRankings').replaceChildren(...activities.map(activity=>{
  const panel=el('article','ha-ranking');panel.dataset.tone=activity.includes('DRILL')?'violet':activity.includes('문법')?'gold':activity.includes('퀴즈')?'cyan':'blue';panel.append(el('h4','',activity));
  const list=el('ol');const rows=rankRecords(records.filter(r=>r.activity===activity));
  for(const rank of [1,2,3]){
   const tied=rows.filter(r=>r.rank===rank);if(!tied.length)continue;
   const li=el('li','ha-rank-row ha-rank-'+rank);li.append(el('span','ha-place',String(rank).padStart(2,'0')));
   const names=el('div','ha-names');
   for(const row of tied){const button=el('button','ha-name-button',row.student);button.type='button';button.setAttribute('aria-label',`${row.rank}위 ${row.student} ${row.count}개 학습 기록 보기`);button.addEventListener('click',()=>{state.learner=row.learner;state.activity=activity;$('#historyActivity').value=activity;state.view='records';state.limit=20;render()});names.append(button)}
   li.append(names,el('strong','ha-rank-count',tied[0].count+'개'));list.append(li);
  }panel.append(list);return panel;
 }));
 $('#historyEmpty').hidden=records.length>0;
 const visible=records.slice(0,state.limit);
 $('#historyRecords').replaceChildren(...visible.map(r=>{const li=el('li','ha-record');const time=el('time','',dateLabel(r.at));time.dateTime=r.at;
  const copy=el('div','ha-record-copy');copy.append(el('strong','',r.student+' · '+r.course),el('span','',r.unit));
  li.append(time,copy,el('span','ha-tag',r.activity));return li}));
 $('#historyMore').hidden=state.limit>=records.length;$('#historyMore').textContent=`더 보기 (${Math.min(state.limit,records.length)} / ${records.length})`;
 $('#historyMeta').textContent=records.length?`${records.length}건의 학습 기록 · 순위는 활동별 고유 완료 항목 수 기준`:'선택한 기간의 저장된 기록이 없습니다.';
 $('#historyRankView').hidden=state.view!=='rankings';$('#historyRecordView').hidden=state.view!=='records';
 root.querySelectorAll('[data-history-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.historyView===state.view)));
 for(const button of root.querySelectorAll('[data-history-area]'))button.setAttribute('aria-pressed',String(button.dataset.historyArea===state.area));
}
async function getJSON(url,headers,signal){const res=await fetch(url,{headers,signal});if(!res.ok)throw Error('HTTP '+res.status);const data=await res.json();if(data.version!==1||!Array.isArray(data.records))throw Error('Invalid history');return data}
async function load(){
 const seq=++state.request;state.controller?.abort();const controller=new AbortController();state.controller=controller;
 const timer=setTimeout(()=>controller.abort(),25000),p=period(),query=new URLSearchParams(p).toString();
 state.learner='';state.limit=20;state.records=[];$('#historyStatus').textContent='학습 기록을 불러오고 있어요…';root.setAttribute('aria-busy','true');render();
 try{
  const results=await Promise.allSettled([getJSON(HISTORY_API+'?'+query,{},controller.signal),getJSON(COURSE_HISTORY_API+'?'+query,{Authorization:'Bearer '+COURSE_HISTORY_KEY},controller.signal),state.archive?Promise.resolve(state.archive):getJSON('history-archive.json',{},controller.signal)]);
  if(seq!==state.request)return;
  let available=0;const failures=[];const all=[];
  for(let i=0;i<results.length;i++){
   const result=results[i];if(result.status==='rejected'){failures.push(['단어 TEST·신문 읽기·뉴스데스크·문법 과제','단어장 퀴즈·파닉스·문법 학습','이전 DRILL·문제 풀기'][i]);continue}
   available++;const data=result.value;if(i===2)state.archive=data;
   all.push(...data.records);for(const s of data.sources??[])if(s.status!=='ok')failures.push(s.label);
  }
  const seen=new Set();state.records=all.map(sanitizeRecord).filter(r=>r&&matchesPeriod(r,p)&&!seen.has(r.id)&&seen.add(r.id)).sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));
  const activities=[...new Set(state.records.filter(r=>state.area==='all'||r.area===state.area).map(r=>r.activity))];
  const select=$('#historyActivity');select.replaceChildren(new Option('모든 활동','all'),...activities.map(a=>new Option(a,a)));state.activity='all';
  $('#historyStatus').textContent=failures.length?'일부 기록 연결 지연: '+[...new Set(failures)].join(', ')+'. 불러온 기록만 표시합니다.':`조회 완료 · ${p.year}년 ${p.month==='all'?'전체':p.month+'월'}`;
  $('#historyStatus').dataset.error=String(failures.length>0);
  $('#historyEmpty').textContent=available===0?'기록을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.':'선택한 기간에 저장된 기록이 없어요.';
  render();
 }finally{clearTimeout(timer);if(seq===state.request)root.removeAttribute('aria-busy')}
}
function chooseArea(area){state.area=area;state.activity='all';state.learner='';state.limit=20;const activities=[...new Set(state.records.filter(r=>area==='all'||r.area===area).map(r=>r.activity))];$('#historyActivity').replaceChildren(new Option('모든 활동','all'),...activities.map(a=>new Option(a,a)));render()}
function quick(mode){const now=today();let year=now.getUTCFullYear(),month=now.getUTCMonth()+1;if(mode==='lastmonth'){month--;if(month===0){month=12;year--}}if(mode==='lastyear'){year--;month='all'}$('#historyYear').value=String(year);$('#historyMonth').value=String(month);load()}
function init(){root.querySelectorAll('[data-history-view]').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.historyView;render()}));const now=today();for(let y=now.getUTCFullYear();y>=2025;y--)$('#historyYear').append(new Option(y+'년',String(y)));$('#historyMonth').value=String(now.getUTCMonth()+1);
 for(const [key,label]of Object.entries(AREAS)){const button=el('button','',label);button.type='button';button.dataset.historyArea=key;button.setAttribute('aria-pressed',String(key==='all'));button.addEventListener('click',()=>chooseArea(key));$('#historyAreas').append(button)}
 $('#historyYear').addEventListener('change',load);$('#historyMonth').addEventListener('change',load);$('#historyReload').addEventListener('click',load);
 root.querySelectorAll('[data-history-quick]').forEach(b=>b.addEventListener('click',()=>quick(b.dataset.historyQuick)));
 $('#historyActivity').addEventListener('change',()=>{state.activity=$('#historyActivity').value;state.limit=20;state.learner='';render()});$('#historySearch').addEventListener('input',()=>{state.limit=20;render()});$('#historyResetStudent').addEventListener('click',()=>{state.learner='';render()});$('#historyMore').addEventListener('click',()=>{state.limit+=20;render()});load();
 // Refresh only the open page, without duplicating requests or resetting a student's filters.
 let lastRefresh=Date.now();setInterval(()=>{if(!document.hidden&&Date.now()-lastRefresh>300000&&!state.learner&&!$('#historySearch').value){lastRefresh=Date.now();load()}},60000);
}
if(root)init();
