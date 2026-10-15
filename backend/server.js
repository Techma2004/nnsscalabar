require('dotenv').config();
const os = require('os');
const path = require('path');
const fs = require('fs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const db = require('./db');
const { routeLimiter, parseCookies, originGuard, securityHeaders } = require('./middleware/security');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '127.0.0.1';
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const isProduction = process.env.NODE_ENV === 'production';

const jwtSecret = String(process.env.JWT_SECRET || '');
if (jwtSecret.length < 32 || /^(replace|change[-_ ]?me|your[-_ ]|example|default|generate[-_ ]|insert[-_ ]|put[-_ ])/i.test(jwtSecret)) {
  throw new Error('JWT_SECRET must be a unique random secret of at least 32 characters; do not use a placeholder value.');
}
const dbPassword = String(process.env.DB_PASSWORD || '');
if (/^(change-this-database-password|replace-with-a-long-unique-password)/i.test(dbPassword)) {
  throw new Error('DB_PASSWORD is still a placeholder; configure a unique database password before starting the server.');
}
app.disable('x-powered-by');

// Trust only the exact number of reverse-proxy hops configured by the operator.
// Default 0 means direct client connections. Never use trust proxy=true: it can
// let clients spoof X-Forwarded-For and bypass IP-based rate limits.
const trustProxyHopsRaw = process.env.TRUST_PROXY_HOPS ?? '0';
if (!/^(0|[1-9][0-9]*)$/.test(trustProxyHopsRaw)) {
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
}
const trustProxyHops = Number(trustProxyHopsRaw);
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops > 10) {
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
}
app.set('trust proxy', trustProxyHops === 0 ? false : trustProxyHops);

// Bound API request volume before body parsing, authentication, or database work.
// The in-memory store is suitable for this single-process deployment; use a shared
// store if the API is later scaled across multiple instances.
const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many API requests. Please try again later.' }
});
app.use('/api', apiRateLimit);

app.use(securityHeaders(isProduction));
const explicitOrigins=(process.env.FRONTEND_ORIGIN||'').split(',').map(v=>v.trim()).filter(Boolean);
function getAllowedOrigins(){
  const origins=new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://[::1]:${PORT}`,
    ...explicitOrigins
  ]);
  for(const address of getLanAddresses()) origins.add(`http://${address}:${PORT}`);
  return origins;
}
app.use(cors({
  origin(origin,callback){
    if(!origin||getAllowedOrigins().has(origin)) return callback(null,true);
    return callback(Object.assign(new Error('Origin not allowed by CORS'),{status:403,expose:true}));
  },
  credentials:true,
  methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization']
}));
// Reject state-changing requests that a browser reports as coming from another site.
app.use(originGuard((origin,req)=>{
  if(getAllowedOrigins().has(origin)) return true;
  try{return new URL(origin).host===req.get('host');}catch{return false;}
}));
// OCR score-sheet images are sent as base64 JSON and need a larger body limit.
// Keep this route-specific parser before the global parser so normal API requests
// remain tightly bounded without breaking score-sheet import.
app.use('/api/results/ai-import', express.json({limit:'11mb'}));
// Excel score sheets (<= 4 MB) are also sent as base64 JSON.
app.use('/api/results/sheet/import', express.json({limit:'6mb'}));
// News-team pictures (<= 2.5 MB) also arrive as base64 JSON.
app.use('/api/posts/image', express.json({limit:'4mb'}));

app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true,limit:'1mb'}));
app.use(parseCookies);
const authAttempts=new Map();
const authIpAttempts=new Map();
const LOGIN_WINDOW_MS=15*60*1000;
const LOGIN_MAX_ATTEMPTS=10;
const LOGIN_IP_MAX_ATTEMPTS=300;
const LOGIN_MAX_ENTRIES=5000;
const LOGIN_IP_MAX_ENTRIES=10000;

function cleanupAttemptMap(map,now=Date.now()){
  for(const [key,entry] of map){
    if(now>=entry.resetAt) map.delete(key);
  }
}

function consumeAttempt(map,key,maxEntries,maxAttempts,now){
  let entry=map.get(key);
  if(!entry||now>=entry.resetAt){
    if(map.size>=maxEntries){
      cleanupAttemptMap(map,now);
      // Bound memory even if a burst contains only unique keys.
      if(map.size>=maxEntries){
        const oldestKey=map.keys().next().value;
        if(oldestKey!==undefined) map.delete(oldestKey);
      }
    }
    map.set(key,{count:1,resetAt:now+LOGIN_WINDOW_MS});
    return true;
  }
  entry.count+=1;
  return entry.count<=maxAttempts;
}

function loginRateLimit(req,res,next){
  const now=Date.now();
  // Account codes are at most 20 characters in this app; truncating only the
  // limiter key prevents arbitrary large request values from bloating memory.
  const userCode=String(req.body?.user_code||'').trim().toUpperCase().slice(0,20);
  if(!consumeAttempt(authIpAttempts,req.ip,LOGIN_IP_MAX_ENTRIES,LOGIN_IP_MAX_ATTEMPTS,now)){
    return res.status(429).json({error:'Too many login attempts from this network. Please try again later.'});
  }
  if(!consumeAttempt(authAttempts,`${req.ip}:${userCode}`,LOGIN_MAX_ENTRIES,LOGIN_MAX_ATTEMPTS,now)){
    return res.status(429).json({error:'Too many login attempts. Please try again later.'});
  }
  next();
}

const authCleanupTimer=setInterval(()=>{cleanupAttemptMap(authAttempts);cleanupAttemptMap(authIpAttempts);},LOGIN_WINDOW_MS);
authCleanupTimer.unref();

app.use('/api/auth/login',loginRateLimit);
app.get('/api/health',async(req,res)=>{try{await db.query('SELECT 1');res.json({status:'ok',service:'nnss-calabar-api',database:'connected',time:new Date().toISOString()});}catch(err){res.status(503).json({status:'degraded',service:'nnss-calabar-api',database:'unavailable'});}});
app.use('/api/auth',require('./routes/auth'));
app.use('/api/admin',require('./routes/admin'));
app.use('/api/students',require('./routes/students'));
app.use('/api/results',require('./routes/results'));
app.use('/api/assignments',require('./routes/assignments'));
app.use('/api/announcements',require('./routes/announcements'));
app.use('/api/dashboard',require('./routes/dashboard'));
app.use('/api/people',require('./routes/people'));
app.use('/api/posts',require('./routes/posts'));
app.use('/api/requests',require('./routes/requests'));
if(fs.existsSync(FRONTEND_DIR)){
  // Static pages touch the file system, so they get their own (generous) ceiling.
  const staticLimit=routeLimiter(1000,'Too many page requests. Please try again later.');
  app.use(staticLimit);
  app.use(express.static(FRONTEND_DIR,{extensions:['html'],maxAge:isProduction?'1h':0}));
  // Express 5 (path-to-regexp 8) rejects a bare '*'; a named wildcard is required.
  app.get('/{*splat}',(req,res,next)=>{if(req.path.startsWith('/api/'))return next();res.sendFile(path.join(FRONTEND_DIR,'index.html'));});
}
app.use((req,res)=>res.status(404).json({error:'Route not found.'}));
app.use((err,_req,res,next)=>{
  const status=Number.isInteger(err.status)&&err.status>=400&&err.status<600?err.status:500;
  if(status>=500)console.error('[server]',err.stack||err.message||err);
  if(res.headersSent)return next(err);
  // Client errors (bad JSON, body too large, blocked origin) are safe to describe; server errors are not.
  const message=status<500?(status===413?'Request is too large.':status===403?'Request not allowed.':'Invalid request.'):(isProduction?'An unexpected server error occurred.':err.message);
  res.status(status).json({error:message});
});
function getLanAddresses(){const nets=os.networkInterfaces();const addresses=[];for(const name of Object.keys(nets))for(const net of nets[name]||[])if(net.family==='IPv4'&&!net.internal)addresses.push(net.address);return addresses;}
const server=app.listen(PORT,HOST,async()=>{try{await db.query('SELECT 1');console.log('Database connection: OK');}catch(err){console.error('Database connection failed:',err.message);}console.log(`NNSS Calabar server listening on http://localhost:${PORT}`);if(HOST==='0.0.0.0'||HOST==='::'){const lan=getLanAddresses();if(lan.length){console.log('Also reachable on this network at:');lan.forEach(ip=>console.log(`  http://${ip}:${PORT}`));console.log('Share one of the addresses above with devices on the same wifi/LAN to let them use the portal.');}else console.log('No LAN network interface detected yet — connect this machine to the school network to enable local-network access.');}});
async function shutdown(signal){console.log(`${signal} received; shutting down...`);const force=setTimeout(()=>process.exit(1),10000);force.unref();server.close(async()=>{try{await db.end();}finally{process.exit(0);}});}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
app.server=server;
module.exports=app;
