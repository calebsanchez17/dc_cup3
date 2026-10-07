import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {initDb,all,one,run,transaction,exec,config,setConfig,replaceTournamentStructure,ROOT} from './database.js';
import {PLACE_POINTS,standings} from './scoring.js';

await initDb();
const app=express();
const PORT=Number(process.env.PORT||4000);
const IS_PROD=process.env.NODE_ENV==='production';
app.disable('x-powered-by');
app.set('trust proxy',process.env.TRUST_PROXY==='1'?1:false);
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'same-origin'}}));
app.use(express.json({limit:'500kb'}));
app.use(cookieParser());

const now=()=>new Date().toISOString();
const fail=(status,message)=>Object.assign(new Error(message),{status});
const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
const clean=(s,max=100)=>String(s??'').trim().slice(0,max);
const isPassword=s=>typeof s==='string'&&s.length>=10&&s.length<=128;
const nameValid=s=>typeof s==='string'&&s.trim().length>=2&&s.trim().length<=60;
const isInstagram=s=>!s||/^@?[a-zA-Z0-9._]{1,30}$/.test(String(s).trim());
const sessionCookie={httpOnly:true,secure:IS_PROD,sameSite:'strict',path:'/',maxAge:1000*60*60*12};
const uploader=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024,files:1}});
const uploads=process.env.UPLOAD_DIR?path.resolve(process.env.UPLOAD_DIR):path.join(ROOT,'uploads');fs.mkdirSync(uploads,{recursive:true});
app.use('/uploads',express.static(uploads,{immutable:true,maxAge:'1d',index:false,dotfiles:'deny'}));

const liveClients=new Set();
function broadcastUpdate(reason='update'){
  const payload=`event: update\ndata: ${JSON.stringify({reason,at:Date.now()})}\n\n`;
  for(const res of liveClients){try{res.write(payload);}catch{liveClients.delete(res);}}
}
app.get('/api/events',(req,res)=>{
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();res.write(`event: ready\ndata: ${Date.now()}\n\n`);liveClients.add(res);
  const keep=setInterval(()=>{try{res.write(': ping\n\n');}catch{}},25000);
  req.on('close',()=>{clearInterval(keep);liveClients.delete(res);});
});

function userFromToken(token){
  const p=jwt.verify(token,process.env.JWT_SECRET);
  if(p.kind==='staff'){
    const s=one('SELECT id,username,displayName,instagram,active FROM staff_accounts WHERE id=?',[p.sub]);
    if(!s||!s.active) throw Error();
    return {...s,role:'score_admin',teamId:null,source:'staff'};
  }
  const u=one('SELECT id,username,role,teamId FROM users WHERE id=?',[p.sub]);if(!u)throw Error();return {...u,source:'user'};
}
const auth=(req,res,next)=>{try{const token=req.cookies.dc_session;if(!token)throw Error();req.user=userFromToken(token);next();}catch{next(fail(401,'Necesitas iniciar sesión.'));}};
const admin=(req,res,next)=>req.user?.role==='admin'?next():next(fail(403,'Solo el administrador principal puede realizar esta acción.'));
const scorer=(req,res,next)=>['admin','score_admin'].includes(req.user?.role)?next():next(fail(403,'Solo organización o moderadores autorizados pueden registrar puntajes.'));
const log=(req,action,detail='')=>run('INSERT INTO audit(actor,action,detail,ip,createdAt) VALUES(?,?,?,?,?)',[req.user?.username||'sistema',action,clean(detail,220),req.ip,now()]);
const changed=(req,action,detail='')=>{log(req,action,detail);broadcastUpdate(action);};

function fileUpload(req,kind){
  if(!req.file)throw fail(400,'Selecciona un archivo.');const b=req.file.buffer;
  const png=b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg=b.length>3&&b[0]===255&&b[1]===216&&b[2]===255;
  const webp=b.length>12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
  const mp3=b.length>3&&(b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224));
  const ogg=b.length>4&&b.toString('ascii',0,4)==='OggS';
  if(kind==='logo'&&!png)throw fail(400,'El logo debe ser PNG, preferiblemente transparente.');
  if(kind==='photo'&&!(png||jpg||webp))throw fail(400,'La imagen debe ser PNG, JPG o WEBP.');
  if(kind==='audio'&&!(mp3||ogg))throw fail(400,'El audio debe ser MP3 u OGG.');
  const ext=png?'png':jpg?'jpg':webp?'webp':ogg?'ogg':'mp3';const filename=crypto.randomUUID()+'.'+ext;fs.writeFileSync(path.join(uploads,filename),b,{flag:'wx'});return '/uploads/'+filename;
}

const publicTeam=t=>({...t,players:all('SELECT position,name,photo FROM players WHERE teamId=? ORDER BY position',[t.id])});
const parseMatchups=stage=>String(stage.matchups||'ALL').split(',').map(x=>x.trim()).filter(Boolean);
const numberConfig=(c,key,fallback)=>Math.max(0,Number(c[key]??fallback)||fallback);
const labels=n=>Array.from({length:Math.max(1,Number(n)||1)},(_,i)=>String.fromCharCode(65+i));
function assignmentsFor(teamIds,groupCount){
  const out=[];const groups=Math.max(1,Number(groupCount)||1);const base=Math.floor(teamIds.length/groups),extra=teamIds.length%groups;let at=0;
  for(let gi=0;gi<groups;gi++){const size=base+(gi<extra?1:0);for(let slot=1;slot<=size;slot++){out.push({teamId:teamIds[at++],groupLabel:String.fromCharCode(65+gi),slot});}}
  return out;
}
function participantsForRoom(room,assignments){
  const allIds=assignments.map(a=>a.teamId);const matchup=String(room.matchup||'ALL').toUpperCase().replaceAll('×','X');
  if(['ALL','FINAL','TODOS'].includes(matchup))return allIds;
  const groupSet=new Set(matchup.split('X').map(x=>x.trim()).filter(x=>/^[A-Z]$/.test(x)));
  if(!groupSet.size&&/^[A-Z]$/.test(matchup))groupSet.add(matchup);
  if(!groupSet.size)return allIds;
  return assignments.filter(a=>groupSet.has(a.groupLabel)).map(a=>a.teamId);
}
function production(){
  const manual=all('SELECT id,type,displayName,instagram,photo,sortOrder FROM production_people WHERE active=1 ORDER BY type,sortOrder,id').map(x=>({...x,source:'manual'}));
  const staff=all('SELECT id,displayName,instagram,photo FROM staff_accounts WHERE active=1 AND showPublic=1 ORDER BY id').map((x,i)=>({...x,id:`staff-${x.id}`,type:'moderator',sortOrder:100+i,source:'staff'}));
  return [...manual,...staff].sort((a,b)=>a.type.localeCompare(b.type)||Number(a.sortOrder)-Number(b.sortOrder));
}
function state(){
  const c=config();const teamCount=numberConfig(c,'teamCount',36);const groupCount=numberConfig(c,'groupCount',3);
  const teams=all('SELECT * FROM teams WHERE id<=? ORDER BY id',[teamCount]).map(publicTeam);
  const defs=all('SELECT * FROM tournament_stages ORDER BY sortOrder,id').map(s=>({...s,enabled:Boolean(s.enabled),isFinal:Boolean(s.isFinal),matchups:parseMatchups(s)}));
  const active=defs.filter(s=>s.enabled);const allResults=all('SELECT * FROM stage_results');let previousQualified=null;const stages=[];
  for(const stage of active){
    const participantLimit=Math.min(Number(stage.participantCount)||teams.length,teams.length);
    let stageTeamIds=previousQualified===null?teams.slice(0,participantLimit).map(t=>t.id):previousQualified.slice(0,participantLimit);
    const groupAssignments=assignmentsFor(stageTeamIds,stage.groupCount);
    const stageTeams=teams.filter(t=>stageTeamIds.includes(t.id));
    const rooms=all('SELECT * FROM stage_rooms WHERE stageId=? ORDER BY jornada,id',[stage.id]);
    const roomPayload=rooms.map(r=>({...r,participantIds:participantsForRoom(r,groupAssignments)}));
    const roomIds=new Set(rooms.map(r=>r.id));const results=allResults.filter(r=>roomIds.has(r.roomId));
    const ranking=standings(stageTeams,rooms,results,Number(stage.goldThreshold)||0);
    const assignmentMap=new Map(groupAssignments.map(a=>[a.teamId,a]));
    const rankingDecorated=ranking.map(t=>({...t,stageGroup:assignmentMap.get(t.id)?.groupLabel||'',stageSlot:assignmentMap.get(t.id)?.slot||0}));
    const groupStandings=labels(stage.groupCount).map(g=>({groupLabel:g,rows:rankingDecorated.filter(t=>t.stageGroup===g)}));
    const expected=roomPayload.reduce((sum,r)=>sum+r.participantIds.length,0);const complete=stageTeamIds.length>0&&rooms.length>0&&results.length===expected;
    let qualifiedIds=[];
    if(complete&&!stage.isFinal){
      if(stage.qualificationMode==='per_group'){
        const picked=[];for(const g of groupStandings)picked.push(...g.rows.slice(0,Number(stage.qualifiersPerGroup)||0).map(x=>x.id));
        const set=new Set(picked);qualifiedIds=rankingDecorated.filter(x=>set.has(x.id)).map(x=>x.id);
      }else qualifiedIds=rankingDecorated.slice(0,Math.min(Number(stage.qualifiers)||0,rankingDecorated.length)).map(x=>x.id);
    }
    stages.push({...stage,groupAssignments,teamIds:stageTeamIds,rooms:roomPayload,standings:rankingDecorated,groupStandings,progress:{done:results.length,total:expected},complete,qualifiedIds,totalRooms:rooms.length,groupSize:Math.ceil((Number(stage.participantCount)||0)/Math.max(1,Number(stage.groupCount)||1))});
    previousQualified=qualifiedIds;
  }
  return {config:c,teamCount,groupCount,teams,stages,stageDefinitions:defs,results:allResults,production:production(),scoring:{placement:PLACE_POINTS.slice(1)},serverTime:now()};
}

app.get('/api/public',wrap((req,res)=>res.json(state())));
app.get('/api/me',wrap((req,res)=>{const token=req.cookies.dc_session;if(!token)return res.json({user:null});try{return res.json({user:userFromToken(token)});}catch{return res.json({user:null});}}));
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Demasiados intentos. Espera 15 minutos antes de volver a ingresar.'}});
app.post('/api/login',loginLimiter,wrap((req,res)=>{
  const username=clean(req.body?.username,60),password=req.body?.password;
  let record=one('SELECT * FROM users WHERE username=?',[username]),kind='user';
  if(!record){record=one('SELECT * FROM staff_accounts WHERE username=?',[username]);kind='staff';}
  const hash=record?.passwordHash||'$2a$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36dA4XrL1gFXJbEQ2YKUMnW';
  if(typeof password!=='string'||!bcrypt.compareSync(password,hash)||!record||(kind==='staff'&&!record.active))throw fail(401,'Usuario o contraseña incorrectos.');
  if(kind==='staff')run('UPDATE staff_accounts SET lastLogin=?,lastIp=? WHERE id=?',[now(),req.ip,record.id]);else run('UPDATE users SET lastLogin=?,lastIp=? WHERE id=?',[now(),req.ip,record.id]);
  const role=kind==='staff'?'score_admin':record.role;const token=jwt.sign({sub:record.id,kind},process.env.JWT_SECRET,{expiresIn:'12h'});res.cookie('dc_session',token,sessionCookie);
  const user={id:record.id,username:record.username,role,teamId:record.teamId||null,displayName:record.displayName||'',instagram:record.instagram||'',source:kind};
  log({user,ip:req.ip},'LOGIN',role==='team'?`Equipo ${record.teamId}`:role==='score_admin'?'Moderación':'Organización');res.json({user});
}));
app.post('/api/logout',wrap((req,res)=>{res.clearCookie('dc_session',{path:'/',sameSite:'strict',secure:IS_PROD});res.json({ok:true});}));
app.get('/api/account',auth,wrap((req,res)=>res.json({user:req.user,team:req.user.teamId?publicTeam(one('SELECT * FROM teams WHERE id=?',[req.user.teamId])):null})));
app.patch('/api/password',auth,wrap((req,res)=>{
  const table=req.user.source==='staff'?'staff_accounts':'users';const u=one(`SELECT passwordHash FROM ${table} WHERE id=?`,[req.user.id]);
  if(!bcrypt.compareSync(req.body?.current||'',u.passwordHash))throw fail(400,'La contraseña actual no coincide.');if(!isPassword(req.body?.next))throw fail(400,'La nueva contraseña debe tener entre 10 y 128 caracteres.');
  run(`UPDATE ${table} SET passwordHash=? WHERE id=?`,[bcrypt.hashSync(req.body.next,12),req.user.id]);changed(req,'CAMBIAR_CLAVE');res.json({ok:true});
}));

app.patch('/api/team/profile',auth,wrap((req,res)=>{if(req.user.role!=='team')throw fail(403,'Esta sección corresponde al equipo.');const name=clean(req.body?.name,60),initials=clean(req.body?.initials,10).toUpperCase();if(!nameValid(name)||!(/^[A-Z0-9]{2,8}$/u).test(initials))throw fail(400,'Nombre: 2 a 60 caracteres. Iniciales: 2 a 8 letras o números.');run('UPDATE teams SET name=?,initials=? WHERE id=?',[name,initials,req.user.teamId]);changed(req,'ACTUALIZAR_EQUIPO',name);res.json({ok:true});}));
app.post('/api/team/logo',auth,uploader.single('file'),wrap((req,res)=>{if(req.user.role!=='team')throw fail(403,'Solo equipos.');const url=fileUpload(req,'logo');run('UPDATE teams SET logo=? WHERE id=?',[url,req.user.teamId]);changed(req,'SUBIR_LOGO');res.json({url});}));
app.put('/api/team/roster',auth,wrap((req,res)=>{if(req.user.role!=='team')throw fail(403,'Solo equipos.');const players=req.body?.players;if(!Array.isArray(players)||players.length>6)throw fail(400,'Se permiten hasta 6 jugadores.');const positions=new Set();const old=all('SELECT position,photo FROM players WHERE teamId=?',[req.user.teamId]);const photos=new Map(old.map(p=>[p.position,p.photo]));const entries=players.map(p=>{const pos=Number(p.position),name=clean(p.name,45);if(!Number.isInteger(pos)||pos<1||pos>6||positions.has(pos)||!nameValid(name))throw fail(400,'Cada jugador debe tener posición única del 1 al 6 y nombre válido.');positions.add(pos);return{pos,name,photo:photos.get(pos)||''};});const managerName=clean(req.body?.managerName,45);transaction(()=>{exec('DELETE FROM players WHERE teamId=?',[req.user.teamId]);entries.forEach(p=>exec('INSERT INTO players(teamId,position,name,photo) VALUES(?,?,?,?)',[req.user.teamId,p.pos,p.name,p.photo]));exec('UPDATE teams SET managerName=? WHERE id=?',[managerName,req.user.teamId]);});changed(req,'ACTUALIZAR_ROSTER',`${entries.length} jugadores`);res.json({ok:true});}));
app.post('/api/team/photo/:target/:position?',auth,uploader.single('file'),wrap((req,res)=>{if(req.user.role!=='team')throw fail(403,'Solo equipos.');const {target,position}=req.params;if(target==='player'){const p=Number(position);if(!Number.isInteger(p)||p<1||p>6||!one('SELECT id FROM players WHERE teamId=? AND position=?',[req.user.teamId,p]))throw fail(400,'Primero guarda el nombre de ese jugador.');const url=fileUpload(req,'photo');run('UPDATE players SET photo=? WHERE teamId=? AND position=?',[url,req.user.teamId,p]);changed(req,'SUBIR_FOTO',`Jugador ${p}`);return res.json({url});}if(target==='manager'){const url=fileUpload(req,'photo');run('UPDATE teams SET managerPhoto=? WHERE id=?',[url,req.user.teamId]);changed(req,'SUBIR_FOTO','Manager');return res.json({url});}throw fail(400,'Tipo de foto no válido.');}));

app.get('/api/admin',auth,admin,wrap((req,res)=>{
  const accounts=all('SELECT id,username,role,teamId,createdAt,lastLogin,lastIp FROM users ORDER BY role,teamId,id');
  const staff=all('SELECT id,username,displayName,instagram,photo,active,showPublic,lastLogin,lastIp,createdAt FROM staff_accounts ORDER BY id');
  const people=all('SELECT id,type,displayName,instagram,photo,active,sortOrder FROM production_people ORDER BY type,sortOrder,id');
  res.json({accounts,staff,people,audit:all('SELECT actor,action,detail,ip,createdAt FROM audit ORDER BY id DESC LIMIT 120')});
}));
app.put('/api/admin/config',auth,admin,wrap((req,res)=>{const whitelist=['eventTitle','editionLabel','organizerName','eventDate','eventStatus','announcement'];for(const key of whitelist)if(Object.prototype.hasOwnProperty.call(req.body||{},key)){let val=clean(req.body[key],400);if(key==='eventDate'&&val&&!(!Number.isNaN(new Date(val).getTime())&&/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(val)))throw fail(400,'La fecha del torneo no es válida.');if(key==='eventDate'&&val&&!/[zZ]|[+-]\d\d:\d\d$/.test(val))val=val.slice(0,16)+':00-05:00';setConfig(key,val);}changed(req,'EDITAR_TORNEO');res.json({ok:true});}));

function validateStructure(body){
  const teamCount=Number(body?.teamCount),stages=body?.stages;if(!Number.isInteger(teamCount)||teamCount<12||teamCount>120)throw fail(400,'La cantidad de equipos debe estar entre 12 y 120.');if(!Array.isArray(stages)||stages.length<1||stages.length>8)throw fail(400,'Configura entre 1 y 8 fases.');
  let previousAvailable=teamCount;
  return {teamCount,groupCount:Number(stages[0]?.groupCount||1),stages:stages.map((raw,i)=>{
    const name=clean(raw.name,50),participantCount=Number(raw.participantCount),groupCount=Number(raw.groupCount),jornadas=Number(raw.jornadas),roomsPerMatchup=Number(raw.roomsPerMatchup),roomMode=String(raw.roomMode||'all'),qualificationMode=raw.qualificationMode==='per_group'?'per_group':'overall';
    if(!nameValid(name))throw fail(400,`La fase ${i+1} necesita un nombre.`);if(!Number.isInteger(participantCount)||participantCount<2||participantCount>teamCount)throw fail(400,`${name}: participantes inválidos.`);if(i===0&&participantCount!==teamCount)throw fail(400,'La primera fase debe comenzar con todos los equipos configurados.');if(i>0&&participantCount>previousAvailable)throw fail(400,`${name}: no puede tener más participantes que los clasificados de la fase anterior (${previousAvailable}).`);
    if(!Number.isInteger(groupCount)||groupCount<1||groupCount>10||groupCount>participantCount)throw fail(400,`${name}: cantidad de grupos inválida.`);const groupSize=Math.ceil(participantCount/groupCount);if(groupSize>12&&roomMode==='groups')throw fail(400,`${name}: cada grupo puede tener como máximo 12 equipos por sala.`);
    const isFinal=i===stages.length-1;const isSemifinal=/SEMIFINAL/i.test(name);
    if(isFinal&&(participantCount!==12||groupCount!==1||roomMode!=='all'))throw fail(400,'La Gran Final debe tener 12 equipos, 1 grupo y modalidad “Todos juntos”.');
    if(isSemifinal&&(participantCount!==18||groupCount!==3||groupSize!==6))throw fail(400,'La Semifinal debe tener 18 equipos distribuidos en 3 grupos de 6.');
    if(!isFinal&&!isSemifinal&&roomMode==='groups'&&(participantCount%groupCount!==0||participantCount/groupCount!==12))throw fail(400,`${name}: las fases previas deben tener exactamente 12 equipos por grupo.`);
    if(!Number.isInteger(jornadas)||jornadas<1||jornadas>10||!Number.isInteger(roomsPerMatchup)||roomsPerMatchup<1||roomsPerMatchup>12)throw fail(400,`${name}: jornadas o salas inválidas.`);if(!['groups','cross','all','custom'].includes(roomMode))throw fail(400,`${name}: modalidad de salas inválida.`);if(roomMode==='all'&&participantCount>12)throw fail(400,`${name}: el modo “Todos juntos” admite máximo 12 equipos.`);
    let matchups=clean(raw.matchups,200);if(roomMode==='groups')matchups=labels(groupCount).join(',');if(roomMode==='all')matchups='FINAL';if((roomMode==='cross'||roomMode==='custom')&&!matchups)throw fail(400,`${name}: indica los cruces.`);
    const matchupList=matchups.split(',').map(x=>x.trim()).filter(Boolean);for(const m of matchupList){if(['ALL','FINAL'].includes(m.toUpperCase())){if(participantCount>12)throw fail(400,`${name}: una sala no puede tener más de 12 equipos.`);continue;}const letters=m.toUpperCase().replaceAll('×','X').split('X').filter(x=>/^[A-Z]$/.test(x));if(letters.length*groupSize>12)throw fail(400,`${name}: el cruce ${m} tendría más de 12 equipos por sala.`);}
    let qualifiers=0,qualifiersPerGroup=0;if(!isFinal){if(qualificationMode==='per_group'){qualifiersPerGroup=Number(raw.qualifiersPerGroup);if(!Number.isInteger(qualifiersPerGroup)||qualifiersPerGroup<1||qualifiersPerGroup>groupSize)throw fail(400,`${name}: clasificados por grupo inválidos.`);qualifiers=qualifiersPerGroup*groupCount;}else{qualifiers=Number(raw.qualifiers);if(!Number.isInteger(qualifiers)||qualifiers<1||qualifiers>=participantCount)throw fail(400,`${name}: cantidad de clasificados inválida.`);}}previousAvailable=qualifiers||participantCount;
    return {stageKey:clean(raw.stageKey,40)||`fase-${i+1}`,name,enabled:true,participantCount,groupCount,qualificationMode,qualifiersPerGroup,qualifiers,jornadas,roomMode,matchups,roomsPerMatchup,goldThreshold:isFinal?Math.max(0,Number(raw.goldThreshold)||0):0,description:clean(raw.description,500)};
  })};
}
app.put('/api/admin/structure',auth,admin,wrap((req,res)=>{const safe=validateStructure(req.body);replaceTournamentStructure(safe);changed(req,'RECONFIGURAR_TORNEO',`${safe.teamCount} equipos · ${safe.stages.length} fases`);res.json({ok:true});}));

app.put('/api/admin/production',auth,admin,wrap((req,res)=>{const keys=['stream','streamTitle','liveBadge','isLive'];for(const key of keys)if(Object.prototype.hasOwnProperty.call(req.body||{},key)){let value=key==='isLive'?(req.body[key]?'1':'0'):clean(req.body[key],300);if(key==='stream'&&value&&!/^https:\/\//i.test(value))throw fail(400,'El enlace de transmisión debe empezar con https://.');setConfig(key,value);}changed(req,'EDITAR_PRODUCCION');res.json({ok:true});}));
app.put('/api/admin/people',auth,admin,wrap((req,res)=>{const people=req.body?.people;if(!Array.isArray(people)||people.length>30)throw fail(400,'Lista de producción inválida.');const safe=people.map((p,i)=>{const type=p.type==='caster'?'caster':'moderator',displayName=clean(p.displayName,60),instagram=clean(p.instagram,35);if(!nameValid(displayName)||!isInstagram(instagram))throw fail(400,`Persona ${i+1}: nombre o Instagram inválido.`);return{id:Number(p.id)||null,type,displayName,instagram,photo:clean(p.photo,200),active:p.active!==false,sortOrder:i+1};});transaction(()=>{const keep=new Set(safe.filter(p=>p.id).map(p=>p.id));for(const old of all('SELECT id FROM production_people'))if(!keep.has(old.id))exec('DELETE FROM production_people WHERE id=?',[old.id]);for(const p of safe){if(p.id&&one('SELECT id FROM production_people WHERE id=?',[p.id]))exec('UPDATE production_people SET type=?,displayName=?,instagram=?,active=?,sortOrder=? WHERE id=?',[p.type,p.displayName,p.instagram,p.active?1:0,p.sortOrder,p.id]);else exec('INSERT INTO production_people(type,displayName,instagram,photo,active,sortOrder) VALUES(?,?,?,?,?,?)',[p.type,p.displayName,p.instagram,p.photo,p.active?1:0,p.sortOrder]);}});changed(req,'EDITAR_STAFF_PUBLICO',`${safe.length} perfiles`);res.json({ok:true});}));
app.post('/api/admin/people/:id/photo',auth,admin,uploader.single('file'),wrap((req,res)=>{const id=Number(req.params.id);if(!one('SELECT id FROM production_people WHERE id=?',[id]))throw fail(404,'Perfil no encontrado.');const url=fileUpload(req,'photo');run('UPDATE production_people SET photo=? WHERE id=?',[url,id]);changed(req,'SUBIR_FOTO_PRODUCCION');res.json({url});}));
app.post('/api/admin/live-cover',auth,admin,uploader.single('file'),wrap((req,res)=>{const url=fileUpload(req,'photo');setConfig('liveImage',url);changed(req,'SUBIR_PORTADA_LIVE');res.json({url});}));
app.post('/api/admin/music',auth,admin,uploader.single('file'),wrap((req,res)=>{const url=fileUpload(req,'audio');setConfig('music',url);changed(req,'SUBIR_MUSICA');res.json({url});}));

app.post('/api/admin/staff',auth,admin,wrap((req,res)=>{const username=clean(req.body?.username,60),password=req.body?.password,displayName=clean(req.body?.displayName,60),instagram=clean(req.body?.instagram,35),showPublic=req.body?.showPublic!==false;if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||!isPassword(password)||!nameValid(displayName)||!isInstagram(instagram))throw fail(400,'Completa nombre, Instagram válido, usuario y contraseña de 10+ caracteres.');if(one('SELECT id FROM users WHERE username=?',[username])||one('SELECT id FROM staff_accounts WHERE username=?',[username]))throw fail(409,'Ese usuario ya existe.');run('INSERT INTO staff_accounts(username,passwordHash,displayName,instagram,active,showPublic,createdAt) VALUES(?,?,?,?,1,?,?)',[username,bcrypt.hashSync(password,12),displayName,instagram,showPublic?1:0,now()]);changed(req,'CREAR_MODERADOR',displayName);res.json({ok:true});}));
app.put('/api/admin/staff/:id',auth,admin,wrap((req,res)=>{const id=Number(req.params.id),old=one('SELECT * FROM staff_accounts WHERE id=?',[id]);if(!old)throw fail(404,'Moderador no encontrado.');const username=clean(req.body?.username,60),displayName=clean(req.body?.displayName,60),instagram=clean(req.body?.instagram,35),password=req.body?.password;if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||!nameValid(displayName)||!isInstagram(instagram)|| (password&&!isPassword(password)))throw fail(400,'Datos del moderador inválidos.');if(one('SELECT id FROM users WHERE username=?',[username])||one('SELECT id FROM staff_accounts WHERE username=? AND id!=?',[username,id]))throw fail(409,'Ese usuario ya existe.');run('UPDATE staff_accounts SET username=?,displayName=?,instagram=?,active=?,showPublic=? WHERE id=?',[username,displayName,instagram,req.body.active===false?0:1,req.body.showPublic===false?0:1,id]);if(password)run('UPDATE staff_accounts SET passwordHash=? WHERE id=?',[bcrypt.hashSync(password,12),id]);changed(req,'EDITAR_MODERADOR',displayName);res.json({ok:true});}));
app.delete('/api/admin/staff/:id',auth,admin,wrap((req,res)=>{const id=Number(req.params.id),s=one('SELECT displayName FROM staff_accounts WHERE id=?',[id]);if(!s)throw fail(404,'Moderador no encontrado.');run('DELETE FROM staff_accounts WHERE id=?',[id]);changed(req,'ELIMINAR_MODERADOR',s.displayName);res.json({ok:true});}));
app.post('/api/admin/staff/:id/photo',auth,admin,uploader.single('file'),wrap((req,res)=>{const id=Number(req.params.id);if(!one('SELECT id FROM staff_accounts WHERE id=?',[id]))throw fail(404,'Moderador no encontrado.');const url=fileUpload(req,'photo');run('UPDATE staff_accounts SET photo=? WHERE id=?',[url,id]);changed(req,'SUBIR_FOTO_MODERADOR');res.json({url});}));

app.put('/api/admin/team/:id',auth,admin,wrap((req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||!one('SELECT id FROM teams WHERE id=?',[id]))throw fail(400,'Equipo no válido.');const name=clean(req.body?.name,60),initials=clean(req.body?.initials,10).toUpperCase();if(!nameValid(name)||!(/^[A-Z0-9]{2,8}$/u).test(initials))throw fail(400,'Nombre o iniciales no válidos.');run('UPDATE teams SET name=?,initials=? WHERE id=?',[name,initials,id]);changed(req,'EDITAR_EQUIPO',`${id} ${name}`);res.json({ok:true});}));
app.put('/api/admin/account/:teamId',auth,admin,wrap((req,res)=>{const teamId=Number(req.params.teamId);if(!Number.isInteger(teamId)||!one('SELECT id FROM teams WHERE id=?',[teamId]))throw fail(400,'Equipo no válido.');const username=clean(req.body?.username,60),password=req.body?.password;if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||!isPassword(password))throw fail(400,'Usuario: 3 a 40 caracteres. Contraseña: 10 a 128 caracteres.');const existing=one("SELECT id FROM users WHERE role='team' AND teamId=?",[teamId]);if(one('SELECT id FROM users WHERE username=? AND id!=?',[username,existing?.id??-1])||one('SELECT id FROM staff_accounts WHERE username=?',[username]))throw fail(409,'Ese usuario ya existe.');const hash=bcrypt.hashSync(password,12);if(existing)run('UPDATE users SET username=?,passwordHash=? WHERE id=?',[username,hash,existing.id]);else run("INSERT INTO users(username,passwordHash,role,teamId,createdAt) VALUES(?,?,'team',?,?)",[username,hash,teamId,now()]);changed(req,existing?'REINICIAR_CREDENCIALES':'CREAR_CUENTA',`Equipo ${teamId}: ${username}`);res.json({ok:true});}));

app.put('/api/admin/results/:roomId',auth,scorer,wrap((req,res)=>{const roomId=Number(req.params.roomId),room=one('SELECT * FROM stage_rooms WHERE id=?',[roomId]);if(!room)throw fail(404,'Sala no encontrada.');const s=state(),stage=s.stages.find(x=>x.id===room.stageId);if(!stage)throw fail(400,'La fase no está activa.');const stageIndex=s.stages.findIndex(x=>x.id===stage.id);if(stageIndex>0&&!s.stages[stageIndex-1].complete)throw fail(400,'Completa la fase anterior antes de registrar esta fase.');const roomState=stage.rooms.find(r=>r.id===roomId);const allowed=new Set(roomState.participantIds),data=req.body?.results;if(!Array.isArray(data)||data.length>12)throw fail(400,'Envía hasta 12 resultados para la sala.');const uniqueTeams=new Set(),uniquePlaces=new Set();const safe=data.map(x=>{const teamId=Number(x.teamId),placement=Number(x.placement),kills=Number(x.kills);if(!allowed.has(teamId)||!Number.isInteger(placement)||placement<1||placement>12||!Number.isInteger(kills)||kills<0||kills>99||uniqueTeams.has(teamId)||uniquePlaces.has(placement))throw fail(400,'Equipos, posiciones o bajas inválidos/repetidos.');uniqueTeams.add(teamId);uniquePlaces.add(placement);return{teamId,placement,kills};});transaction(()=>{exec('DELETE FROM stage_results WHERE roomId=?',[roomId]);safe.forEach(x=>exec('INSERT INTO stage_results(roomId,teamId,placement,kills) VALUES(?,?,?,?)',[roomId,x.teamId,x.placement,x.kills]));});changed(req,'REGISTRAR_RESULTADOS',`${room.label}: ${safe.length} equipos`);res.json({ok:true});}));

app.get('/api/health',(req,res)=>res.json({ok:true,time:now()}));
const built=path.join(ROOT,'client','dist');if(fs.existsSync(built)){app.use(express.static(built,{index:false}));app.get('*',(req,res)=>res.sendFile(path.join(built,'index.html')));}else{app.get('/',(req,res)=>res.type('text').send('Frontend no compilado. Ejecuta npm run dev o npm run build.'));}
app.use((err,req,res,next)=>{if(err.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Archivo demasiado grande (máximo 15 MB).'});if(err.message?.includes('UNIQUE constraint failed'))return res.status(409).json({error:'Ya existe un registro duplicado.'});if(!err.status)console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Ocurrió un error inesperado. Revisa el servidor.'});});
if(process.env.NODE_ENV!=='test')app.listen(PORT,()=>console.log(`DC CUP API disponible en http://localhost:${PORT}`));
export default app;
