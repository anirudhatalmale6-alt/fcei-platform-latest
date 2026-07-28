import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

try{const ef=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),".env"),"utf8");ef.split(String.fromCharCode(10)).forEach(l=>{const[k,...v]=l.split("=");if(k&&k.trim()&&!k.startsWith("#"))process.env[k.trim()]=v.join("=").trim();})}catch(e){}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const SEED_PATH = path.join(__dirname, 'data', 'seed.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'storage', 'uploads');
const CERT_DIR = path.join(__dirname, 'storage', 'certificates');
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'mailadmin@fcei.eu';
const FROM_EMAIL = process.env.FROM_EMAIL || 'platform@fcei.eu';
const TEMPLATE_DIR = path.join(__dirname, 'templates');

function sendMail(to, subject, htmlBody, fromName, fromEmail) {
  const senderName = fromName || 'FCEI Platform';
  const senderEmail = fromEmail || FROM_EMAIL;
  return new Promise((resolve) => {
    const msg = [
      'From: ' + senderName + ' <' + senderEmail + '>',
      'To: ' + to,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      'Date: ' + new Date().toUTCString(),
      '',
      htmlBody
    ].join('\r\n');
    const cmds = [
      'EHLO fcei.eu',
      'MAIL FROM:<' + senderEmail + '>',
      'RCPT TO:<' + to + '>',
      'DATA'
    ];
    let step = 0;
    let buf = '';
    const sock = net.createConnection(25, '127.0.0.1');
    sock.setEncoding('utf8');
    sock.setTimeout(15000);
    sock.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\r\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.substring(0, 3), 10);
        if (code >= 400) { console.error('SMTP error:', line); sock.end('QUIT\r\n'); resolve(false); return; }
        if (step < cmds.length) {
          sock.write(cmds[step++] + '\r\n');
        } else if (step === cmds.length) {
          sock.write(msg + '\r\n.\r\n');
          step++;
        } else {
          sock.end('QUIT\r\n');
        }
      }
    });
    sock.on('end', () => resolve(true));
    sock.on('error', (e) => { console.error('Mail error:', e.message); resolve(false); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function bookingNotifyHtml(b) {
  return '<div style="font-family:sans-serif;max-width:600px;margin:0 auto">' +
    '<div style="background:#0f2a38;color:#fff;padding:24px 28px;border-radius:12px 12px 0 0">' +
    '<h2 style="margin:0;font-size:20px">New Enquiry / Booking Request</h2></div>' +
    '<div style="border:1px solid #e5e5e5;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px">' +
    '<tr><td style="padding:8px 0;color:#666;width:140px">Name</td><td style="padding:8px 0;font-weight:600">' + (b.name||'') + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0"><a href="mailto:' + (b.email||'') + '">' + (b.email||'') + '</a></td></tr>' +
    '<tr><td style="padding:8px 0;color:#666">Organisation</td><td style="padding:8px 0">' + (b.organisation||b.service||'-') + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#666">Preferred date</td><td style="padding:8px 0">' + (b.date||'-') + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#666">Audience</td><td style="padding:8px 0">' + (b.audience||'-') + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#666;vertical-align:top">Message</td><td style="padding:8px 0">' + (b.message||b.notes||'-') + '</td></tr>' +
    '</table>' +
    '<hr style="margin:20px 0;border:none;border-top:1px solid #eee">' +
    '<p style="font-size:13px;color:#999;margin:0">Sent from the FCEI platform booking form</p>' +
    '</div></div>';
}
function renderVars(template, vars) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => String(vars[key] ?? ''));
}

const _senderCache = new Map();
const _templateCache = new Map();

async function getSender(senderKey) {
  if (_senderCache.has(senderKey)) return _senderCache.get(senderKey);
  const s = await prisma.emailSenderIdentity.findUnique({ where: { senderKey } });
  if (s) _senderCache.set(senderKey, s);
  return s;
}

async function getTemplate(triggerName) {
  if (_templateCache.has(triggerName)) return _templateCache.get(triggerName);
  const t = await prisma.emailTemplate.findUnique({ where: { triggerName } });
  if (t) _templateCache.set(triggerName, t);
  return t;
}

function loadTemplateFile(templateId, type) {
  const ext = type === 'html' ? 'html' : 'txt';
  const fp = path.join(TEMPLATE_DIR, ext, templateId + '.' + ext);
  try { return fs.readFileSync(fp, 'utf8'); } catch { return null; }
}

async function sendTriggeredEmail(triggerName, recipientEmail, variables) {
  try {
    const tmpl = await getTemplate(triggerName);
    if (!tmpl || !tmpl.isActive) { console.log('Email trigger skipped (no template):', triggerName); return false; }
    const sender = await getSender(tmpl.senderKey);
    if (!sender || !sender.isActive) { console.log('Email trigger skipped (no sender):', tmpl.senderKey); return false; }

    const vars = { brand_logo_url: SITE_URL.replace(/#.*$/, '') + '/assets/fcei-bridge-icon-512.png', brand_name: 'Finland Creative Education Institute (FCEI)', brand_platform_description: 'Digital professional learning platform', brand_strapline: 'Finnish-inspired • EDUFI-aligned • FINEEC-benchmarked', brand_contact_email: 'hello@fcei.eu', brand_website: 'www.fcei.eu', email_preferences_url: SITE_URL + '#/settings', privacy_policy_url: SITE_URL + '#/privacy', support_faq_url: SITE_URL + '#/support', ...variables };
    const subject = renderVars(tmpl.subject, vars);
    let htmlBody = loadTemplateFile(tmpl.templateId, 'html') || tmpl.bodyHtml;
    if (htmlBody) htmlBody = renderVars(htmlBody, vars);
    else htmlBody = '<p>' + renderVars(tmpl.preheader || subject, vars) + '</p>';

    const logEntry = await prisma.emailDeliveryLog.create({ data: { templateId: tmpl.templateId, triggerName, recipientEmail, status: 'sending', createdAt: new Date() } });
    const ok = await sendMail(recipientEmail, subject, htmlBody, sender.displayName, sender.email);
    await prisma.emailDeliveryLog.update({ where: { id: logEntry.id }, data: { status: ok ? 'sent' : 'failed', sentAt: ok ? new Date() : null, errorMessage: ok ? null : 'SMTP delivery failed' } });
    console.log('Email', ok ? 'sent' : 'FAILED', '-', triggerName, '->', recipientEmail);
    return ok;
  } catch (e) {
    console.error('sendTriggeredEmail error:', triggerName, e.message);
    return false;
  }
}

const SCORM_DIR = path.join(__dirname, 'scorm');
for (const d of [UPLOAD_DIR,CERT_DIR]) fs.mkdirSync(d,{recursive:true});
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_RESTRICTED_KEY || '';
const SITE_URL = process.env.SITE_URL || 'https://fcei.eu/platform';
const SEO_DATA = JSON.parse(fs.readFileSync(path.join(__dirname,'data','seo.json'),'utf8'));
const ORG_JSONLD = JSON.stringify({"@context":"https://schema.org","@type":"Organization","name":"Finland Creative Education Institute","url":"https://fcei.eu","logo":"https://fcei.eu/platform/fcei-logo.png","description":"Finnish-inspired teacher training and school improvement platform. EDUFI-aligned, FINEEC-benchmarked.","sameAs":["https://fcei.eu"]});

const prisma = new PrismaClient();

function injectSEO(html, opts) {
  var title = opts.title || 'FCEI | Finnish Creative Education Institute';
  var desc = opts.desc || 'Finnish-inspired teacher training and school improvement. EDUFI-aligned, FINEEC-benchmarked professional development courses.';
  var ogTitle = opts.ogTitle || title;
  var ogDesc = opts.ogDesc || desc;
  var canonical = opts.canonical || 'https://fcei.eu';
  var jsonld = opts.jsonld || ORG_JSONLD;
  var noindex = opts.noindex || false;
  function rep(h,regex,tag){ return regex.test(h) ? h.replace(regex,tag) : h.replace('</head>',tag+'\n</head>'); }
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + title + '</title>');
  html = rep(html, /<meta name="description"[^>]*>/, '<meta name="description" content="' + desc.replace(/"/g,'&quot;') + '">');
  html = rep(html, /<link rel="canonical"[^>]*>/, '<link rel="canonical" href="' + canonical + '">');
  html = rep(html, /<meta property="og:title"[^>]*>/, '<meta property="og:title" content="' + ogTitle.replace(/"/g,'&quot;') + '">');
  html = rep(html, /<meta property="og:description"[^>]*>/, '<meta property="og:description" content="' + ogDesc.replace(/"/g,'&quot;') + '">');
  html = rep(html, /<meta property="og:url"[^>]*>/, '<meta property="og:url" content="' + canonical + '">');
  var extra = '<link rel="icon" type="image/png" href="/fcei-logo.png">\n' + (noindex ? '<meta name="robots" content="noindex,nofollow">\n' : '<meta name="robots" content="index,follow">\n') +
    '<meta name="twitter:card" content="summary_large_image">\n' + '<meta name="twitter:title" content="' + ogTitle.replace(/"/g,'&quot;') + '">\n' + '<meta name="twitter:description" content="' + ogDesc.replace(/"/g,'&quot;') + '">\n' +
    '<script type="application/ld+json">' + jsonld + '</script>\n';
  html = html.replace('</head>', extra + '</head>');
  return html;
}

function stripeRequest(endpoint, params, method) {
  return new Promise((resolve, reject) => {
    const m = method || 'POST';
    const data = m === 'GET' ? '' : new URLSearchParams(params).toString();
    const p = m === 'GET' && Object.keys(params).length ? endpoint + '?' + new URLSearchParams(params).toString() : endpoint;
    const headers = { 'Authorization': 'Bearer ' + STRIPE_KEY };
    if (m === 'POST') { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(data); }
    const options = { hostname: 'api.stripe.com', port: 443, path: p, method: m, headers };
    const r = https.request(options, (res) => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    });
    r.on('error', reject);
    if (m === 'POST') r.write(data);
    r.end();
  });
}
const PREMIUM_COUNTRIES = new Set([
  'GB','IE','FR','DE','IT','ES','PT','NL','BE','LU','AT','CH','SE','NO','DK','FI','IS',
  'PL','CZ','SK','HU','RO','BG','HR','SI','EE','LV','LT','GR','CY','MT',
  'US','CA','MX','AU','NZ','SG','SA','AE','OM','QA','BH','KW','CN','HK','MO','TW','JP','KR'
]);
const PREMIUM_SURCHARGE = 2000;
function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function geoLookup(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) { resolve(''); return; }
    const clean = ip.replace(/^::ffff:/, '');
    const options = { hostname: 'ip-api.com', path: '/json/' + clean + '?fields=countryCode', timeout: 3000 };
    const r = http.get(options, (res) => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body).countryCode || ''); } catch(e) { resolve(''); } });
    });
    r.on('error', () => resolve(''));
    r.on('timeout', () => { r.destroy(); resolve(''); });
    setTimeout(() => { try { r.destroy(); } catch(e) {} resolve(''); }, 4000);
  });
}

const seed = JSON.parse(fs.readFileSync(SEED_PATH,'utf8'));
const flags = ['contentOpened','resourcesAccessed','quizPassed','actionTaskSubmitted','evidenceSubmitted','reflectionSubmitted','transferabilitySubmitted','checklistCompleted'];

function uid(p){ return `${p}-${crypto.randomBytes(6).toString('hex')}`; }
function now(){ return new Date().toISOString(); }
const SEC_HDRS={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','X-XSS-Protection':'1; mode=block','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const ALLOWED_ORIGINS=new Set(['https://fcei.eu','https://www.fcei.eu','http://localhost:8787']);
function corsOrigin(req){ const o=(req&&req.headers&&req.headers.origin)||''; return ALLOWED_ORIGINS.has(o)?o:'https://fcei.eu'; }
function sendJson(res,status,body,req){ res.writeHead(status, {...SEC_HDRS,'Content-Type':'application/json','Access-Control-Allow-Origin':corsOrigin(req),'Access-Control-Allow-Headers':'Content-Type, Authorization, X-Session-Token','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'}); res.end(JSON.stringify(body,null,2)); }
function sendText(res,status,body,type='text/plain'){ res.writeHead(status, {...SEC_HDRS,'Content-Type':type,'Access-Control-Allow-Origin':'https://fcei.eu'}); res.end(body); }
function bad(res,msg,status=400,req=null){ sendJson(res,status,{error:msg},req); }
function parseUrl(req){ const u=new URL(req.url,'http://localhost'); return {path:u.pathname, query:Object.fromEntries(u.searchParams.entries())}; }
function body(req){ return new Promise((resolve,reject)=>{ const chunks=[]; req.on('data',c=>chunks.push(c)); req.on('end',()=>resolve(Buffer.concat(chunks))); req.on('error',reject); }); }
function jsonParse(buf){ try{return JSON.parse(buf.toString()||'{}')}catch{return {}} }
function course(id){ return seed.courses.find(c=>c.id===id); }
function mod(id){ return seed.modules.find(m=>m.id===id); }
function mods(courseId){ return seed.modules.filter(m=>m.courseId===courseId).sort((a,b)=>a.order-b.order); }
function product(id){ return seed.products.find(p=>p.id===id); }
function publicUser(u){ return {id:u.id,name:u.name,email:u.email,role:u.role}; }
function hash(p){ if(!p||!String(p).trim()) return '!EMPTY!'; return crypto.createHash('sha256').update(String(p)).digest('hex'); }
function sanitize(s){ return String(s||'').replace(/[<>"]/g, c=>({'<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c)); }
function sessionExpiry(){ return new Date(Date.now()+24*60*60*1000).toISOString(); }
const _rateLimits=new Map();
function rateLimit(key,max,windowMs){ const n=Date.now(); let rec=_rateLimits.get(key); if(!rec||n-rec.start>windowMs){rec={start:n,count:0};_rateLimits.set(key,rec);} rec.count++; return rec.count>max; }

async function audit(action,actorId='system',meta={}){
  await prisma.auditLog.create({data:{id:uid('AUD'),action,actorId:actorId==='system'?null:actorId,meta,at:new Date()}});
}

async function userFromReq(req){
  const h=req.headers.authorization||'';
  const t=h.startsWith('Bearer ')?h.slice(7):(req.headers['x-session-token']||'');
  if(!t) return null;
  const s=await prisma.session.findUnique({where:{token:t}});
  if(!s || s.revokedAt || (s.expiresAt && new Date(s.expiresAt)<new Date())) return null;
  return prisma.user.findUnique({where:{id:s.userId}});
}

async function requireUser(req,res){
  const u=await userFromReq(req);
  if(!u){bad(res,'Authentication required',401); return null;}
  return u;
}

async function requireAdmin(req,res){
  const u=await requireUser(req,res);
  if(!u) return null;
  if(u.role!=='ADMIN'){bad(res,'Admin only',403); return null;}
  return u;
}

async function hasCourse(userId,courseId){
  const ents = await prisma.entitlement.findMany({where:{userId,status:'ACTIVE'}});
  return ents.some(e=>(e.courseIds||[]).includes(courseId));
}

async function hasToolkit(userId,toolkitId){
  const ents = await prisma.entitlement.findMany({where:{userId,status:'ACTIVE'}});
  return ents.some(e=>((e.toolkitIds||[]).includes(toolkitId)|| (e.toolkitIds||[]).includes('TOOLKIT-FULL')));
}

async function ensureProgress(userId,courseId,moduleId){
  let p=await prisma.progress.findFirst({where:{userId,moduleId}});
  if(!p){
    const data={id:uid('PROG'),userId,courseId,moduleId,status:'NOT_STARTED',percent:0,updatedAt:new Date()};
    for(const f of flags) data[f]=false;
    p=await prisma.progress.create({data});
  }
  return p;
}

function recalcFields(p){
  const done=flags.filter(f=>p[f]).length;
  const percent=Math.round(done/flags.length*100);
  const status=done===flags.length?'COMPLETE':done>0?'IN_PROGRESS':'NOT_STARTED';
  const completedAt=(status==='COMPLETE'&&!p.completedAt)?new Date():p.completedAt;
  return {percent,status,updatedAt:new Date(),completedAt};
}

async function recalc(progressId, data){
  const merged={...data};
  const done=flags.filter(f=>merged[f]).length;
  merged.percent=Math.round(done/flags.length*100);
  merged.status=done===flags.length?'COMPLETE':done>0?'IN_PROGRESS':'NOT_STARTED';
  merged.updatedAt=new Date();
  if(merged.status==='COMPLETE') merged.completedAt=merged.completedAt||new Date();
  return prisma.progress.update({where:{id:progressId},data:merged});
}

async function ensureEnrollments(userId,courseIds){
  for(const courseId of courseIds){
    const existing=await prisma.enrolment.findFirst({where:{userId,courseId}});
    if(!existing) await prisma.enrolment.create({data:{id:uid('ENR'),userId,courseId,status:'ACTIVE',createdAt:new Date()}});
    for(const m of mods(courseId)) await ensureProgress(userId,courseId,m.id);
  }
}

async function grant(user,p){
  const courseIds=p.courseIds||[];
  const toolkitIds=(p.type||'').includes('TOOLKIT')?[p.id]:[];
  const e=await prisma.entitlement.create({data:{id:uid('ENT'),userId:user.id,productId:p.id,status:'ACTIVE',courseIds,toolkitIds,access:p.access||'all_courses',createdAt:new Date()}});
  await ensureEnrollments(user.id,courseIds);
  return e;
}

async function certificateIfComplete(user,courseId){
  const all=mods(courseId);
  if(!all.length) return null;
  const progresses=await prisma.progress.findMany({where:{userId:user.id,moduleId:{in:all.map(m=>m.id)}}});
  const complete=all.every(m=>progresses.find(p=>p.moduleId===m.id&&p.status==='COMPLETE'));
  if(!complete) return null;
  let cert=await prisma.certificate.findFirst({where:{userId:user.id,courseId}});
  const isNewCompletion = !cert;
  if(!cert){
    const code=`FCEI-${courseId}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    cert=await prisma.certificate.create({data:{id:uid('CERT'),userId:user.id,courseId,issuedAt:new Date(),pdfUrl:`/verify/${code}`}});
    fs.writeFileSync(path.join(CERT_DIR,`${code}.txt`),`FCEI Completion Record\n${user.name}\n${course(courseId)?.title}\n${code}\n${new Date().toISOString()}\n`);
  }
  if (isNewCompletion) {
    const cTitle = course(courseId)?.title || courseId;
    const firstName = user.name.split(' ')[0];
    sendTriggeredEmail('course.completed', user.email, { learner_first_name: firstName, course_title: cTitle, profile_url: SITE_URL + '#/dashboard' }).catch(() => {});
    sendTriggeredEmail('certificate.issued', user.email, { learner_first_name: firstName, course_title: cTitle, certificate_url: SITE_URL + '#/dashboard' }).catch(() => {});
  }
  return cert;
}

async function dashboard(user){
  const enrols=await prisma.enrolment.findMany({where:{userId:user.id,status:'ACTIVE'}});
  const courses=[];
  for(const e of enrols){
    const ms=mods(e.courseId);
    const ps=[];
    for(const m of ms) ps.push(await ensureProgress(user.id,e.courseId,m.id));
    const c=course(e.courseId);
    const complete=ps.filter(p=>p.status==='COMPLETE').length;
    const next=ms.find(m=>!ps.find(p=>p.moduleId===m.id&&p.status==='COMPLETE'));
    const cert=await prisma.certificate.findFirst({where:{userId:user.id,courseId:e.courseId}});
    courses.push({course:c,totalModules:ms.length,completedModules:complete,progressPercent:ms.length?Math.round(complete/ms.length*100):0,nextModuleId:next?.id||null,certificateStatus:cert?.status||'NOT_ELIGIBLE'});
  }
  const entitlements=await prisma.entitlement.findMany({where:{userId:user.id}});
  const certificates=await prisma.certificate.findMany({where:{userId:user.id}});
  const toolkitDownloads=await prisma.toolkitDownload.findMany({where:{userId:user.id}});
  return {user:publicUser(user),courses,entitlements,certificates,toolkitDownloads};
}

function sendFile(res,file){ if(!fs.existsSync(file))return bad(res,'File not found',404); const ext=path.extname(file); const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.txt':'text/plain','.md':'text/markdown','.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon'}; const cacheTime=['.jpg','.jpeg','.png','.webp','.gif','.svg','.woff2','.woff','.ico'].includes(ext)?86400:['.css','.js'].includes(ext)?3600:0; res.writeHead(200, {...SEC_HDRS,'Content-Type':types[ext]||'application/octet-stream','Cache-Control':cacheTime?'public, max-age='+cacheTime:'no-cache'}); fs.createReadStream(file).pipe(res); }

async function multipart(req,boundary){ const buf=await body(req); const raw=buf.toString('binary'); const parts=raw.split(`--${boundary}`).filter(p=>p.includes('Content-Disposition')); const fields={}; const files=[]; for(const p of parts){ const [head,b='']=p.split('\r\n\r\n'); const nm=/name="([^"]+)"/.exec(head); if(!nm)continue; const fm=/filename="([^"]*)"/.exec(head); const content=b.replace(/\r\n--$/,'').replace(/\r\n$/,''); if(fm && fm[1]){ const safe=path.basename(fm[1]).replace(/[^a-zA-Z0-9._-]/g,'_'); const stored=`${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${safe}`; fs.writeFileSync(path.join(UPLOAD_DIR,stored),Buffer.from(content,'binary')); files.push({field:nm[1],originalName:safe,url:`/uploads/${stored}`}); } else fields[nm[1]]=content; } return {fields,files}; }

async function api(req,res,pathname,query){
  if(req.method==='OPTIONS') return sendJson(res,200,{});
  try{
    if(req.method==='GET' && pathname==='/api/site') return sendJson(res,200,{brand:seed.brand,copy:seed.siteCopy,content:seed.content,courses:seed.courses,products:seed.products,services:seed.services});
    if(req.method==='GET' && pathname==='/api/catalogue') return sendJson(res,200,{courses:seed.courses,products:seed.products,tags:[...new Set(seed.courses.flatMap(c=>c.tags||[]))],copy:seed.siteCopy});
    if(req.method==='GET' && pathname.startsWith('/api/courses/')){ const cid=pathname.split('/')[3]; const c=course(cid); if(!c) return bad(res,'Course not found',404); return sendJson(res,200,{course:c,modules:mods(cid),product:seed.products.find(p=>(p.courseIds||[]).includes(cid)&&p.type==='COURSE')}); }

    if(req.method==='GET' && pathname==='/api/user/entitlements'){
      const u=await userFromReq(req);
      if(!u) return sendJson(res,200,{courseIds:[]});
      const ents=await prisma.entitlement.findMany({where:{userId:u.id,status:'ACTIVE'}});
      const cids=[]; ents.forEach(e=>(e.courseIds||[]).forEach(c=>{if(!cids.includes(c))cids.push(c);}));
      return sendJson(res,200,{courseIds:cids});
    }

    if(req.method==='POST' && pathname==='/api/auth/register'){
      const clientIp=getClientIp(req);
      if(rateLimit('reg:'+clientIp,5,300000)) return bad(res,'Too many attempts, try again later',429);
      const b=jsonParse(await body(req));
      if(!b.email||!String(b.email).includes('@'))return bad(res,'Valid email required');
      if(!b.password||String(b.password).length<6)return bad(res,'Password must be at least 6 characters');
      const existing=await prisma.user.findUnique({where:{email:b.email.toLowerCase().trim()}});
      if(existing) return bad(res,'Email already registered',409);
      const u=await prisma.user.create({data:{id:uid('USER'),name:sanitize(b.name||b.email.split('@')[0]),email:b.email.toLowerCase().trim(),passwordHash:hash(b.password),role:'LEARNER',createdAt:new Date()}});
      const token=uid('SESS');
      await prisma.session.create({data:{id:uid('SESSION'),userId:u.id,token,createdAt:new Date()}});
      await audit('auth.register',u.id);
      sendTriggeredEmail('user.account_created', u.email, { learner_first_name: u.name.split(' ')[0], login_url: SITE_URL + '#/login' }).catch(() => {});
      return sendJson(res,201,{user:publicUser(u),token});
    }

    if(req.method==='POST' && pathname==='/api/auth/login'){
      const clientIp=getClientIp(req);
      if(rateLimit('login:'+clientIp,10,300000)) return bad(res,'Too many attempts, try again later',429);
      const b=jsonParse(await body(req));
      const u=await prisma.user.findUnique({where:{email:String(b.email||'').toLowerCase().trim()}});
      if(!u || u.passwordHash!==hash(b.password)) return bad(res,'Invalid login',401);
      const token=uid('SESS');
      await prisma.session.create({data:{id:uid('SESSION'),userId:u.id,token,createdAt:new Date()}});
      return sendJson(res,200,{user:publicUser(u),token});
    }

    if(req.method==='POST' && pathname==='/api/auth/logout'){
      const h=req.headers.authorization||'';
      const t=h.startsWith('Bearer ')?h.slice(7):(req.headers['x-session-token']||'');
      if(t){
        const s=await prisma.session.findUnique({where:{token:t}});
        if(s) await prisma.session.delete({where:{id:s.id}});
      }
      return sendJson(res,200,{loggedOut:true});
    }

    if(req.method==='POST' && pathname==='/api/checkout/create'){
      const u=await requireUser(req,res); if(!u)return;
      const b=jsonParse(await body(req));
      const p=product(b.productId); if(!p)return bad(res,'Product not found');
      const order=await prisma.order.create({data:{id:uid('ORDER'),userId:u.id,productId:p.id,status:'PENDING',amount:p.price,currency:p.currency||'USD',createdAt:new Date()}});
      await audit('checkout.create',u.id,{orderId:order.id,productId:p.id});
      try {
        const clientIp=getClientIp(req);
        const country=await geoLookup(clientIp);
        const isPremium=PREMIUM_COUNTRIES.has(country);
        const finalPrice=isPremium?p.price+PREMIUM_SURCHARGE:p.price;
        const session=await stripeRequest('/v1/checkout/sessions', {
          'payment_method_types[0]': 'card',
          'line_items[0][price_data][currency]': (p.currency||'usd').toLowerCase(),
          'line_items[0][price_data][unit_amount]': String(finalPrice),
          'line_items[0][price_data][product_data][name]': (p.title || course((p.courseIds||[])[0])?.title || 'FCEI Course'),
          'line_items[0][quantity]': '1',
          'mode': 'payment',
          'success_url': SITE_URL.replace(/#.*$/,'') + '/stripe-success?session_id={CHECKOUT_SESSION_ID}&order_id=' + order.id,
          'cancel_url': SITE_URL + '#/catalogue',
          'client_reference_id': order.id,
          'customer_email': u.email,
          'metadata[orderId]': order.id,
          'metadata[userId]': u.id,
          'metadata[productId]': p.id
        });
        if(session.error) return bad(res, session.error.message || 'Stripe error');
        const updated=await prisma.order.update({where:{id:order.id},data:{stripeSessionId:session.id}});
        return sendJson(res,200,{order:{...updated,country,isPremium,finalAmount:finalPrice}, checkoutUrl: session.url});
      } catch(e) { console.error('Stripe error:', e); return bad(res, 'Payment service error'); }
    }

    if(req.method==='POST' && pathname==='/api/payments/stripe-confirm'){
      const u=await requireUser(req,res); if(!u)return;
      const b=jsonParse(await body(req));
      const o=await prisma.order.findFirst({where:{id:b.orderId,userId:u.id}});
      if(!o)return bad(res,'Order not found');
      if(o.status==='PAID'){ const d=await dashboard(u); return sendJson(res,200,{order:o,already:true,dashboard:d}); }
      try {
        const session=await stripeRequest('/v1/checkout/sessions/'+(b.sessionId||o.stripeSessionId),{},'GET');
        if(!session || session.payment_status!=='paid') return bad(res,'Payment not yet confirmed');
        const updated=await prisma.order.update({where:{id:o.id},data:{status:'PAID',paidAt:new Date()}});
        const p=product(o.productId);
        const pay=await prisma.payment.create({data:{id:uid('PAY'),orderId:o.id,userId:u.id,status:'PAID',amount:o.amount,currency:o.currency,provider:'stripe',createdAt:new Date()}});
        const ent=await grant(u,p);
        await audit('payment.confirmed',u.id,{orderId:o.id,entitlementId:ent.id,provider:'stripe'});
        const pTitle = p.title || course((p.courseIds||[])[0])?.title || 'FCEI Course';
        sendTriggeredEmail('payment.succeeded', u.email, { learner_first_name: u.name.split(' ')[0], product_title: pTitle, payment_amount: (o.currency||'USD') + ' ' + (o.amount/100).toFixed(2), payment_date: new Date().toLocaleDateString('en-GB'), receipt_number: pay.id, profile_url: SITE_URL + '#/dashboard' }).catch(() => {});
        for (const cid of (p.courseIds||[])) {
          const c = course(cid); const firstMod = mods(cid)[0];
          sendTriggeredEmail('enrolment.completed', u.email, { learner_first_name: u.name.split(' ')[0], course_title: c?.title || cid, module_title: firstMod?.title || 'Module 1', course_url: SITE_URL + '#/course/' + cid }).catch(() => {});
        }
        const d=await dashboard(u);
        return sendJson(res,200,{order:updated,payment:pay,entitlement:ent,dashboard:d});
      } catch(e) { console.error('Stripe verify error:', e); return bad(res,'Could not verify payment'); }
    }

    if(req.method==='GET' && pathname==='/api/dashboard'){
      const u=await requireUser(req,res); if(!u)return;
      const d=await dashboard(u);
      return sendJson(res,200,d);
    }

    const modMatch=pathname.match(/^\/api\/lms\/courses\/([^/]+)\/modules\/([^/]+)$/);
    if(req.method==='GET'&&modMatch){
      const u=await requireUser(req,res); if(!u)return;
      const [_,courseId,moduleId]=modMatch;
      if(!await hasCourse(u.id,courseId))return bad(res,'Course access required',403);
      const m=mod(moduleId); if(!m||m.courseId!==courseId)return bad(res,'Module not found',404);
      const p=await ensureProgress(u.id,courseId,moduleId);
      const courseMods=mods(courseId);
      const idx=courseMods.findIndex(x=>x.id===moduleId);
      const next=courseMods[idx+1]?.id||null;
      return sendJson(res,200,{module:m,course:course(courseId),progress:p,nextModuleId:next,scormLesson:seed.scormLessons.find(x=>x.moduleId===moduleId)});
    }

    const stepMatch=pathname.match(/^\/api\/lms\/modules\/([^/]+)\/([^/]+)$/);
    if(req.method==='POST'&&stepMatch){
      const u=await requireUser(req,res); if(!u)return;
      const moduleId=stepMatch[1], step=stepMatch[2];
      const m=mod(moduleId); if(!m)return bad(res,'Module not found',404);
      if(!await hasCourse(u.id,m.courseId))return bad(res,'Course access required',403);
      let payload={}; let files=[];
      if(step==='evidence' && (req.headers['content-type']||'').includes('multipart/form-data')){
        const boundary=(req.headers['content-type'].match(/boundary=(.+)$/)||[])[1];
        ({fields:payload,files}=await multipart(req,boundary));
      } else payload=jsonParse(await body(req));

      let p=await ensureProgress(u.id,m.courseId,moduleId);
      const updateData={};

      if(step==='content-opened') updateData.contentOpened=true;
      else if(step==='resource-accessed'){
        updateData.resourcesAccessed=true;
        await prisma.resourceAccess.create({data:{id:uid('RA'),userId:u.id,moduleId,resourceId:payload.resourceId||'any',at:new Date()}});
      } else if(step==='quiz-attempt'){
        const correct=(m.quiz||[]).every((q,i)=>Number(payload.answers?.[i])===Number(q.correctIndex||q.answerIndex||0));
        await prisma.quizAttempt.create({data:{id:uid('QUIZ'),userId:u.id,moduleId,answers:payload.answers||[],passed:correct,at:new Date()}});
        updateData.quizPassed=correct;
      } else if(step==='action-task'){
        await prisma.actionTask.create({data:{id:uid('TASK'),userId:u.id,moduleId,text:sanitize(payload.text||payload.action||''),submittedAt:new Date()}});
        updateData.actionTaskSubmitted=true;
      } else if(step==='evidence'){
        await prisma.evidenceSubmission.create({data:{id:uid('EVID'),userId:u.id,moduleId,title:sanitize(payload.title||'Evidence'),text:sanitize(payload.text||''),files:files||[],status:'SUBMITTED',submittedAt:new Date()}});
        updateData.evidenceSubmitted=true;
        sendTriggeredEmail('evidence.submitted', u.email, { learner_first_name: u.name.split(' ')[0], module_title: m.title || moduleId, submission_url: SITE_URL + '#/lms/' + m.courseId + '/' + moduleId }).catch(() => {});
      } else if(step==='reflection'){
        await prisma.reflection.create({data:{id:uid('REFL'),userId:u.id,moduleId,text:sanitize(payload.text||''),submittedAt:new Date()}});
        updateData.reflectionSubmitted=true;
      } else if(step==='transferability'){
        const keys=['principle','localCondition','classroomAction','evidence','process','structure','syllabi'];
        const complete=keys.every(k=>String(payload[k]||'').trim().length>0);
        await prisma.transferabilityResponse.create({data:{id:uid('TF'),userId:u.id,moduleId,responses:payload,complete,submittedAt:new Date()}});
        updateData.transferabilitySubmitted=complete;
      } else if(step==='checklist'){
        updateData.checklistCompleted=!!payload.confirmed;
      } else return bad(res,'Unknown module step');

      const merged={...p,...updateData};
      p=await recalc(p.id,merged);
      const cert=await certificateIfComplete(u,m.courseId);
      await audit(`lms.${step}`,u.id,{moduleId,status:p.status});
      return sendJson(res,200,{progress:p,certificate:cert});
    }

    if(req.method==='GET' && pathname==='/api/toolkits') return sendJson(res,200,{toolkits:seed.products.filter(p=>(p.type||'').includes('TOOLKIT'))});

    if(req.method==='POST' && pathname.match(/^\/api\/toolkits\/([^/]+)\/purchase$/)){
      const u=await requireUser(req,res); if(!u)return;
      const tid=pathname.split('/')[3];
      const p=product(tid); if(!p)return bad(res,'Toolkit not found');
      if(!p.price || p.price<=0) return bad(res,'Toolkit price not set');
      const order=await prisma.order.create({data:{id:uid('ORDER'),userId:u.id,productId:p.id,status:'PENDING',amount:p.price,currency:p.currency||'USD',createdAt:new Date()}});
      try {
        const session=await stripeRequest('/v1/checkout/sessions', {
          'payment_method_types[0]': 'card',
          'line_items[0][price_data][currency]': (p.currency||'usd').toLowerCase(),
          'line_items[0][price_data][unit_amount]': String(p.price),
          'line_items[0][price_data][product_data][name]': p.title || 'FCEI Toolkit',
          'line_items[0][quantity]': '1',
          'mode': 'payment',
          'success_url': SITE_URL.replace(/#.*$/,'') + '/stripe-success?session_id={CHECKOUT_SESSION_ID}&order_id=' + order.id,
          'cancel_url': SITE_URL + '#/catalogue',
          'client_reference_id': order.id,
          'customer_email': u.email,
          'metadata[orderId]': order.id,
          'metadata[userId]': u.id,
          'metadata[productId]': p.id
        });
        if(session.error) return bad(res, session.error.message);
        await prisma.order.update({where:{id:order.id},data:{stripeSessionId:session.id}});
        return sendJson(res,200,{order, checkoutUrl: session.url});
      } catch(e) { return bad(res,'Payment service error'); }
    }

    if(req.method==='GET' && pathname.match(/^\/api\/toolkits\/([^/]+)\/download$/)){
      const u=await requireUser(req,res); if(!u)return;
      const tid=pathname.split('/')[3];
      if(!await hasToolkit(u.id,tid))return bad(res,'Toolkit purchase required',403);
      await prisma.toolkitDownload.create({data:{id:uid('TD'),userId:u.id,toolkitId:tid,at:new Date()}});
      return sendText(res,200,`FCEI Protected Toolkit Download\nToolkit: ${tid}\nUser: ${u.email}\nGenerated: ${now()}\n`,'text/plain');
    }

    if(req.method==='GET' && pathname==='/api/scorm/lessons') return sendJson(res,200,{lessons:seed.scormLessons,flow:seed.scormTemplateFlow});

    if(req.method==='GET' && pathname.match(/^\/api\/scorm\/lessons\/([^/]+)$/)){
      const moduleId=pathname.split('/').pop().toUpperCase();
      const lesson=seed.scormLessons.find(x=>x.moduleId===moduleId);
      if(!lesson)return bad(res,'SCORM lesson not found',404);
      const obj=JSON.parse(fs.readFileSync(path.join(SCORM_DIR,'lessons',`${moduleId.toLowerCase()}-scorm-lesson.json`),'utf8'));
      return sendJson(res,200,obj);
    }

    if(req.method==='POST' && pathname==='/api/scorm/register'){
      const admin=await requireAdmin(req,res); if(!admin)return;
      const b=jsonParse(await body(req));
      await prisma.scormRegistration.create({data:{id:uid('SCORM'),userId:b.userId||'',lessonId:b.lessonId||'',status:'REGISTERED',createdAt:new Date()}});
      return sendJson(res,200,{registration:{...b,registeredAt:now()}});
    }

    if(req.method==='POST' && pathname.match(/^\/api\/scorm\/runtime\/([^/]+)$/)){
      const u=await requireUser(req,res); if(!u)return;
      const moduleId=pathname.split('/').pop();
      const b=jsonParse(await body(req));
      const rec=await prisma.scormRuntime.create({data:{id:uid('SCORMRT'),registrationId:b.registrationId||uid('REG'),data:{userId:u.id,moduleId,lessonStatus:b.lessonStatus,score:b.score||null,suspendData:b.suspendData||null},updatedAt:new Date()}});
      const m=mod(moduleId);
      if(m && await hasCourse(u.id,m.courseId) && ['completed','passed'].includes(String(b.lessonStatus).toLowerCase())){
        let p=await ensureProgress(u.id,m.courseId,moduleId);
        p=await recalc(p.id,{...p,contentOpened:true});
      }
      return sendJson(res,200,{runtime:rec});
    }

    if(req.method==='POST' && pathname==='/api/bookings'){
      const b=jsonParse(await body(req));
      if(!b.name||!b.email) return bad(res,'Name and email are required');
      const rec=await prisma.booking.create({data:{id:uid('BOOK'),name:sanitize(b.name),email:b.email,service:sanitize(b.organisation||b.service||''),notes:sanitize(b.message||b.notes||''),createdAt:new Date(),status:'NEW'}});
      sendMail(NOTIFY_EMAIL, 'New FCEI Enquiry from ' + sanitize(b.name), bookingNotifyHtml(b), 'FCEI Platform', 'no-reply@fcei.eu').catch(()=>{});
      sendTriggeredEmail('consultancy.enquiry_submitted', b.email, { contact_first_name: (b.name||'').split(' ')[0], institution_name: b.organisation || b.service || 'your institution', consultancy_area: b.audience || 'General enquiry' }).catch(() => {});
      return sendJson(res,200,{booking:rec});
    }

    if(req.method==='POST' && pathname==='/api/cookie-consent'){
      const b=jsonParse(await body(req));
      const rec=await prisma.cookieConsent.create({data:{id:uid('COOKIE'),choice:b.choice||'unknown',ip:req.socket.remoteAddress||'',at:new Date()}});
      return sendJson(res,200,{saved:true,consent:rec});
    }

    if(req.method==='GET' && pathname==='/api/admin/overview'){
      const admin=await requireAdmin(req,res); if(!admin)return;
      const counts={
        users:await prisma.user.count(),
        sessions:await prisma.session.count(),
        orders:await prisma.order.count(),
        payments:await prisma.payment.count(),
        entitlements:await prisma.entitlement.count(),
        enrolments:await prisma.enrolment.count(),
        progress:await prisma.progress.count(),
        certificates:await prisma.certificate.count(),
        bookings:await prisma.booking.count(),
        auditLogs:await prisma.auditLog.count(),
      };
      const recentAudit=await prisma.auditLog.findMany({orderBy:{at:'desc'},take:20});
      return sendJson(res,200,{counts,products:seed.products.length,courses:seed.courses.length,modules:seed.modules.length,scormLessons:seed.scormLessons.length,recentAudit});
    }

    if(req.method==='POST' && pathname==='/api/admin/cms'){
      const admin=await requireAdmin(req,res); if(!admin)return;
      const b=jsonParse(await body(req));
      const slug=b.slug||uid('page');
      await prisma.cmsPage.upsert({where:{slug},create:{id:uid('CMS'),slug,content:b},update:{content:b}});
      return sendJson(res,200,{saved:true});
    }

    if(req.method==='GET' && pathname==='/api/admin/email-log'){
      const admin=await requireAdmin(req,res); if(!admin)return;
      const logs=await prisma.emailDeliveryLog.findMany({orderBy:{createdAt:'desc'},take:50});
      return sendJson(res,200,{logs});
    }

    if(req.method==='GET' && pathname==='/api/admin/email-senders'){
      const admin=await requireAdmin(req,res); if(!admin)return;
      const senders=await prisma.emailSenderIdentity.findMany({orderBy:{senderKey:'asc'}});
      return sendJson(res,200,{senders});
    }

    if(req.method==='GET' && pathname==='/api/admin/email-templates'){
      const admin=await requireAdmin(req,res); if(!admin)return;
      const templates=await prisma.emailTemplate.findMany({orderBy:{triggerName:'asc'}});
      return sendJson(res,200,{templates:templates.map(t=>({...t,bodyHtml:undefined,bodyText:undefined}))});
    }

    if(req.method==='GET' && pathname.match(/^\/api\/certificates\/verify\/([^/]+)$/)){
      const code=decodeURIComponent(pathname.split('/').pop());
      const cert=await prisma.certificate.findFirst({where:{pdfUrl:{contains:code}}});
      if(!cert)return bad(res,'Certificate not found',404);
      return sendJson(res,200,{certificate:cert});
    }

    return bad(res,'API route not found',404);
  } catch(e){ console.error(e); return bad(res,e.message||'Server error',500); }
}

const server=http.createServer(async(req,res)=>{ const {path:pathname,query}=parseUrl(req); if(pathname.startsWith('/api/')) return api(req,res,pathname,query); if(pathname.startsWith('/uploads/')) return sendFile(res,path.join(UPLOAD_DIR,path.basename(pathname))); if(pathname.startsWith('/scorm/lessons/')) return sendFile(res,path.join(SCORM_DIR,'lessons',path.basename(pathname))); if(pathname.startsWith('/scorm/template/')) return sendFile(res,path.join(SCORM_DIR,'template',path.basename(pathname))); if(pathname==='/stripe-success'){ const q=parseUrl(req).query; res.writeHead(302,{'Location':'/#/stripe-success?session_id='+(q.session_id||'')+'&order_id='+(q.order_id||'')}); res.end(); return; }
    if(pathname.startsWith('/courses/')){
      const slug=pathname.replace('/courses/','').replace(/\/$/,'');
      const cid=SEO_DATA[slug];
      if(cid && SEO_DATA[cid]){
        const seo=SEO_DATA[cid];
        const raw=fs.readFileSync(path.join(PUBLIC_DIR,'index.html'),'utf8');
        const out=injectSEO(raw,{title:seo.title_tag,desc:seo.meta_description,ogTitle:seo.og_title,ogDesc:seo.og_description,canonical:seo.canonical_url,jsonld:JSON.stringify(seo.jsonld)}).replace('</body>','<script>if(!location.hash)location.hash="#/course/'+cid+'";</script></body>');
        res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=3600'}); res.end(out); return;
      }
    }
    if(pathname==='/'){
      const ua=(req.headers['user-agent']||'').toLowerCase();
      if(/bot|crawl|spider|slurp|facebook|twitter|whatsapp|telegram|preview|wget/i.test(ua)){
        const raw=fs.readFileSync(path.join(PUBLIC_DIR,'index.html'),'utf8');
        const out=injectSEO(raw,{});
        res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}); res.end(out); return;
      }
    } let file=pathname==='/'?'index.html':pathname.replace(/^\//,''); const target=path.join(PUBLIC_DIR,file); if(fs.existsSync(target)&&target.startsWith(PUBLIC_DIR)) return sendFile(res,target); return sendFile(res,path.join(PUBLIC_DIR,'index.html')); });
server.listen(PORT,()=>console.log(`FCEI live-ready platform (PostgreSQL) running on http://localhost:${PORT}`));
