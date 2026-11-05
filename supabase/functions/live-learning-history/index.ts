// Public read-only projection for GORAE LIVE. Source rows and credentials stay on the server.
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,OPTIONS','Cache-Control':'public,max-age=45','Content-Type':'application/json'};
const mask=(value:string)=>{const s=Array.from(value.trim());return s.length<=1?'○':s[0]+'○'.repeat(Math.max(1,s.length-2))+(s.length>2?s.at(-1):'')};
async function digest(s:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('')}
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});
 if(request.method!=='GET')return Response.json({error:'method'},{status:405,headers});
 const params=new URL(request.url).searchParams,now=new Date(Date.now()+9*3600000),year=Number(params.get('year')??now.getUTCFullYear()),month=params.get('month')??String(now.getUTCMonth()+1),annual=month==='all';
 if(!Number.isInteger(year)||year<2000||year>now.getUTCFullYear()||(!annual&&(!/^\d{1,2}$/.test(month)||Number(month)<1||Number(month)>12)))return Response.json({error:'period'},{status:400,headers});
 const start=new Date(Date.UTC(year,annual?0:Number(month)-1,1)-9*3600000).toISOString(),end=new Date((annual?Date.UTC(year+1,0,1):Date.UTC(year,Number(month),1))-9*3600000).toISOString();
 const base=Deno.env.get('SUPABASE_URL')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 async function read(table:string,select:string,time:string,order:string){
  const rows:any[]=[];
  for(let offset=0;offset<=20000;offset+=1000){
   const q=new URLSearchParams({select,and:`(${time}.gte.${start},${time}.lt.${end})`,order,limit:'1000',offset:String(offset)});
   const res=await fetch(base+'/rest/v1/'+table+'?'+q,{headers:{apikey:secret,Authorization:'Bearer '+secret},signal:AbortSignal.timeout(15000)});
   if(!res.ok)throw Error('Source unavailable');const page=await res.json();rows.push(...page);if(page.length<1000)return rows;
  }throw Error('Result limit');
 }
 const records:any[]=[],sources:any[]=[];
 async function project(id:string,label:string,load:()=>Promise<any[]>,map:(r:any)=>any){
  try{const rows=await load(),out:any[]=[],identities=new Map<string,Promise<string>>();
   for(const row of rows){const r=map(row);if(!r||!r.name||/테스트|연결확인|test|demo/i.test(r.name))continue;
    if(!identities.has(r.who))identities.set(r.who,digest('live:'+r.who));
    out.push({id:await digest(id+':'+r.id),learner:await identities.get(r.who),student:mask(r.name),area:r.area,activity:r.activity,course:r.course,unit:r.unit,at:r.at,unique:await digest(id+':'+r.unique)});
   }records.push(...out);sources.push({id,label,status:'ok'});
  }catch{sources.push({id,label,status:'unavailable'})}
 }
 await Promise.all([
  project('dayquiz','단어장 퀴즈',()=>read('vocab_day_progress','id,student_name,unit_id,quiz_mode,passed_at,vocab_units(title,vocab_books(title,slug))','passed_at','passed_at.desc,id'),r=>({who:'legacy:'+r.student_name,name:r.student_name,id:r.id,area:/phonics/.test(r.vocab_units?.vocab_books?.slug??'')?'phonics':'vocabulary',activity:'단어장 퀴즈 PASS',course:r.vocab_units?.vocab_books?.title??'단어장',unit:(r.vocab_units?.title??'단원')+' · '+({meaning:'뜻 고르기',spelling:'철자',root:'어근',listening:'듣기',sentence:'문장'}[r.quiz_mode as string]??r.quiz_mode),at:r.passed_at,unique:r.student_name+':'+r.unit_id+':'+r.quiz_mode})),
  project('grammar','문법 학습',()=>read('grammar_progress','user_id,student_name,lesson_id,stage,completed_at','completed_at','completed_at.desc,user_id,lesson_id,stage'),r=>({who:'lab:'+r.user_id,name:r.student_name,id:r.user_id+':'+r.lesson_id+':'+r.stage,area:'grammar',activity:'문법 단계 완료',course:'문법 '+r.lesson_id,unit:({learn:'개념 학습',drill:'문법 연습',basic:'기본',advanced:'심화',review:'복습',concept:'개념',practice:'연습',test:'테스트'}[r.stage as string]??r.stage)+' 완료',at:r.completed_at,unique:r.user_id+':'+r.lesson_id+':'+r.stage})),
  project('phonics','파닉스 몬스터',()=>read('study_completions','student_name,item_key,completed_at','completed_at','completed_at.desc,student_name,item_key'),r=>/^phonics:\d+:\d+$/.test(r.item_key)?{who:'legacy:'+r.student_name,name:r.student_name,id:r.student_name+':'+r.item_key,area:'phonics',activity:'파닉스 단원 완료',course:'파닉스 몬스터 '+r.item_key.split(':')[1],unit:'Unit '+r.item_key.split(':')[2],at:r.completed_at,unique:r.student_name+':'+r.item_key}:null)
 ]);
 return Response.json({version:1,generatedAt:new Date().toISOString(),records,sources},{headers});
});
