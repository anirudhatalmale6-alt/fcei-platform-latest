
const BASE='http://localhost:8787';
let token='';
async function req(path,opt={}){const headers={...(opt.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})}; const res=await fetch(BASE+path,{...opt,headers:{...headers,...(opt.headers||{})}}); const data=(res.headers.get('content-type')||'').includes('json')?await res.json():await res.text(); if(!res.ok)throw new Error(`${path}: ${data.error||data}`); return data;}
async function post(path,body={}){return req(path,{method:'POST',body:JSON.stringify(body)});} 
const auth=await post('/api/auth/register',{name:'Acceptance Learner',email:`test-${Date.now()}@fcei.test`,password:'password'}); token=auth.token;
const cat=await req('/api/catalogue'); console.log('courses',cat.courses.length,'products',cat.products.length);
const checkout=await post('/api/checkout/create',{productId:'P-C01'}).catch(()=>post('/api/checkout/create',{productId:'FCEI-FULL-LIBRARY'}));
await post('/api/payments/mock-confirm',{orderId:checkout.order.id});
let dash=await req('/api/dashboard'); console.log('enrolled',dash.courses.length);
const courseId=dash.courses[0].course.id; const moduleId=dash.courses[0].nextModuleId;
await req(`/api/lms/courses/${courseId}/modules/${moduleId}`);
await post(`/api/lms/modules/${moduleId}/content-opened`);
await post(`/api/lms/modules/${moduleId}/resource-accessed`,{resourceId:'R1'});
await post(`/api/lms/modules/${moduleId}/quiz-attempt`,{answers:[0,0,0]});
// if quiz doesn't pass due to varied answer indexes, read module and submit correct indexes
let data=await req(`/api/lms/courses/${courseId}/modules/${moduleId}`); const answers=(data.module.quiz||[]).map(q=>q.correctIndex||q.answerIndex||0); await post(`/api/lms/modules/${moduleId}/quiz-attempt`,{answers});
await post(`/api/lms/modules/${moduleId}/action-task`,{text:'One manageable change planned.'});
await post(`/api/lms/modules/${moduleId}/evidence`,{title:'Evidence',text:'Evidence submitted.'});
await post(`/api/lms/modules/${moduleId}/reflection`,{text:'Reflection submitted.'});
await post(`/api/lms/modules/${moduleId}/transferability`,{principle:'x',localCondition:'x',classroomAction:'x',evidence:'x',process:'x',structure:'x',syllabi:'x'});
const done=await post(`/api/lms/modules/${moduleId}/checklist`,{confirmed:true});
if(done.progress.status!=='COMPLETE') throw new Error('Module did not complete');
await req('/api/scorm/lessons');
await req('/api/toolkits');
await post('/api/toolkits/TOOLKIT-FULL/purchase',{});
await req('/api/toolkits/TOOLKIT-FULL/download');
console.log('ACCEPTANCE FLOW PASSED', done.progress.status, done.progress.percent);
