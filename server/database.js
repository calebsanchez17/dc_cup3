import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import bcrypt from 'bcryptjs';

export const ROOT = process.cwd();
export const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'server', 'data');
const DB_FILE = path.join(DATA, 'dc-cup.sqlite');
let db;

export function all(sql, params = []) {
  const st = db.prepare(sql);
  try {
    st.bind(params);
    const output = [];
    while (st.step()) output.push(st.getAsObject());
    return output;
  } finally { st.free(); }
}
export function one(sql, params = []) { return all(sql, params)[0] || null; }
export function run(sql, params = []) { db.run(sql, params); persist(); return db.getRowsModified(); }
export function exec(sql, params = []) { db.run(sql, params); }
export function persist() {
  fs.mkdirSync(DATA, {recursive:true});
  const out = db.export();
  const temp = `${DB_FILE}.tmp`;
  fs.writeFileSync(temp, Buffer.from(out));
  fs.renameSync(temp, DB_FILE);
}
export function transaction(fn) {
  db.run('BEGIN TRANSACTION');
  try { const output = fn(); db.run('COMMIT'); persist(); return output; }
  catch (error) { db.run('ROLLBACK'); throw error; }
}
export function config() { return Object.fromEntries(all('SELECT key,value FROM config').map(x => [x.key, x.value])); }
export function setConfig(key, value) {
  run('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value ?? '')]);
}

const defaults = {
  eventTitle: 'DC CUP',
  editionLabel: '3RA EDICIÓN',
  organizerName: 'ORGANIZACIÓN DC',
  eventDate: '',
  eventStatus: 'INSCRIPCIONES ABIERTAS',
  stream: '',
  streamTitle: 'EN VIVO · DC CUP',
  liveBadge: 'COBERTURA OFICIAL',
  liveImage: '',
  isLive: '0',
  music: '',
  announcement: 'Bienvenidos a la tercera edición de DC CUP. ¡Que gane el mejor equipo!',
  teamCount: '36',
  groupCount: '3'
};

function hasColumn(table, column) {
  return all(`PRAGMA table_info(${table})`).some(c => c.name === column);
}
function ensureColumn(table, column, definition) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureTeamsInternal(teamCount = 36, groupCount = 3) {
  const maxExisting = Number(one('SELECT MAX(id) maxId FROM teams')?.maxId || 0);
  for (let id = maxExisting + 1; id <= teamCount; id++) {
    exec('INSERT INTO teams(id,groupLabel,slot,name,initials) VALUES(?,?,?,?,?)', [id, `_NEW_${id}`, id, `EQUIPO ${id}`, `E${id}`]);
  }
  const everyTeam = all('SELECT id FROM teams ORDER BY id');
  for (const row of everyTeam) exec('UPDATE teams SET groupLabel=?,slot=? WHERE id=?', [`_TMP_${row.id}`, row.id, row.id]);
  let id = 1;
  const base = Math.floor(teamCount / groupCount);
  const extra = teamCount % groupCount;
  for (let gi = 0; gi < groupCount; gi++) {
    const size = base + (gi < extra ? 1 : 0);
    const label = String.fromCharCode(65 + gi);
    for (let slot = 1; slot <= size; slot++) {
      exec('UPDATE teams SET groupLabel=?,slot=? WHERE id=?', [label, slot, id]);
      const row = one('SELECT name,initials FROM teams WHERE id=?', [id]);
      if (row?.name?.startsWith('EQUIPO ') || !row?.name) exec('UPDATE teams SET name=?,initials=? WHERE id=?', [`EQUIPO ${label}${slot}`, `${label}${slot}`, id]);
      id++;
    }
  }
}

function groupLabels(count) { return Array.from({length:Math.max(1,count)},(_,i)=>String.fromCharCode(65+i)); }
function defaultMatchups(mode, groups) {
  const labels = groupLabels(groups);
  if (mode === 'all') return 'FINAL';
  if (mode === 'groups') return labels.join(',');
  if (mode === 'cross') {
    if (labels.length === 2) return 'AxB';
    if (labels.length === 3) return 'AxB,CxA,BxC';
    const pairs=[];
    for(let i=0;i<labels.length;i+=2) pairs.push(i+1<labels.length?`${labels[i]}x${labels[i+1]}`:`${labels[i]}x${labels[0]}`);
    return pairs.join(',');
  }
  return 'ALL';
}

function seedStagesInternal() {
  if (one('SELECT id FROM tournament_stages LIMIT 1')) return;
  const rows = [
    ['cuartos','CUARTOS DE FINAL',1,1,36,18,1,'A,B,C',1,0,'Tres grupos de 12 equipos. Clasifican 6 equipos por grupo.',3,12,'per_group',6,'groups',0],
    ['semifinal','SEMIFINAL',1,2,18,12,2,'AxB,CxA,BxC',2,0,'18 equipos: Grupo A, B y C con 6 equipos. Clasifican los 12 mejores.',3,6,'overall',0,'cross',0],
    ['final','GRAN FINAL',1,3,12,0,1,'FINAL',6,90,'12 finalistas, 6 salas y Booyah de Oro desde los 90 puntos.',1,12,'overall',0,'all',1]
  ];
  for (const r of rows) exec(`INSERT INTO tournament_stages(stageKey,name,enabled,sortOrder,participantCount,qualifiers,jornadas,matchups,roomsPerMatchup,goldThreshold,description,groupCount,groupSize,qualificationMode,qualifiersPerGroup,roomMode,isFinal)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, r);
}

function buildRoomsInternal() {
  exec('DELETE FROM stage_results');
  exec('DELETE FROM stage_rooms');
  const stages = all('SELECT * FROM tournament_stages WHERE enabled=1 ORDER BY sortOrder,id');
  for (const stage of stages) {
    const raw = stage.roomMode === 'groups' ? defaultMatchups('groups', Number(stage.groupCount))
      : stage.roomMode === 'all' ? 'FINAL'
      : String(stage.matchups || defaultMatchups(stage.roomMode, Number(stage.groupCount)) || 'ALL');
    const matchups = raw.split(',').map(x=>x.trim()).filter(Boolean);
    let ordinalGlobal = 1;
    for (let jornada = 1; jornada <= Number(stage.jornadas); jornada++) {
      for (const matchup of matchups) {
        for (let ordinal = 1; ordinal <= Number(stage.roomsPerMatchup); ordinal++) {
          const label = `${stage.name} · J${jornada} · ${matchup} · Sala ${ordinal}`;
          exec('INSERT INTO stage_rooms(stageId,jornada,matchup,ordinal,label) VALUES(?,?,?,?,?)', [stage.id, jornada, matchup, ordinalGlobal++, label]);
        }
      }
    }
  }
}

export function replaceTournamentStructure({ teamCount, groupCount, stages }) {
  transaction(() => {
    const firstGroups = Number(stages?.[0]?.groupCount || groupCount || 1);
    ensureTeamsInternal(teamCount, firstGroups);
    exec("INSERT INTO config(key,value) VALUES('teamCount',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(teamCount)]);
    exec("INSERT INTO config(key,value) VALUES('groupCount',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [String(firstGroups)]);
    exec('DELETE FROM stage_results');
    exec('DELETE FROM stage_rooms');
    exec('DELETE FROM tournament_stages');
    for (const [index, s] of stages.entries()) {
      const isFinal = index === stages.length - 1 ? 1 : 0;
      const qualificationMode = s.qualificationMode === 'per_group' ? 'per_group' : 'overall';
      const qualifiersPerGroup = qualificationMode === 'per_group' ? Number(s.qualifiersPerGroup || 0) : 0;
      const qualifiers = isFinal ? 0 : (qualificationMode === 'per_group' ? Number(s.groupCount) * qualifiersPerGroup : Number(s.qualifiers || 0));
      const roomMode = ['groups','cross','all','custom'].includes(s.roomMode) ? s.roomMode : 'all';
      const matchups = roomMode === 'groups' ? defaultMatchups('groups', Number(s.groupCount)) : roomMode === 'all' ? 'FINAL' : String(s.matchups || defaultMatchups(roomMode, Number(s.groupCount)));
      exec(`INSERT INTO tournament_stages(stageKey,name,enabled,sortOrder,participantCount,qualifiers,jornadas,matchups,roomsPerMatchup,goldThreshold,description,groupCount,groupSize,qualificationMode,qualifiersPerGroup,roomMode,isFinal)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        s.stageKey, s.name, s.enabled ? 1 : 0, index + 1, Number(s.participantCount), qualifiers,
        Number(s.jornadas), matchups, Number(s.roomsPerMatchup), isFinal ? Number(s.goldThreshold || 0) : 0, s.description || '',
        Number(s.groupCount), Math.ceil(Number(s.participantCount)/Math.max(1,Number(s.groupCount))), qualificationMode, qualifiersPerGroup, roomMode, isFinal
      ]);
    }
    buildRoomsInternal();
  });
}

export async function initDb() {
  fs.mkdirSync(DATA, { recursive: true });
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams(
      id INTEGER PRIMARY KEY, groupLabel TEXT NOT NULL, slot INTEGER NOT NULL, name TEXT NOT NULL, initials TEXT NOT NULL,
      logo TEXT DEFAULT '', managerName TEXT DEFAULT '', managerPhoto TEXT DEFAULT '', UNIQUE(groupLabel,slot)
    );
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL COLLATE NOCASE, passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','team')), teamId INTEGER UNIQUE REFERENCES teams(id), lastLogin TEXT DEFAULT '', lastIp TEXT DEFAULT '', createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players(
      id INTEGER PRIMARY KEY AUTOINCREMENT, teamId INTEGER NOT NULL REFERENCES teams(id), position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 6),
      name TEXT NOT NULL, photo TEXT DEFAULT '', UNIQUE(teamId,position)
    );
    CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, ip TEXT DEFAULT '', createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tournament_stages(
      id INTEGER PRIMARY KEY AUTOINCREMENT, stageKey TEXT UNIQUE NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      sortOrder INTEGER NOT NULL, participantCount INTEGER NOT NULL, qualifiers INTEGER NOT NULL DEFAULT 0, jornadas INTEGER NOT NULL DEFAULT 1,
      matchups TEXT NOT NULL DEFAULT 'ALL', roomsPerMatchup INTEGER NOT NULL DEFAULT 1, goldThreshold INTEGER NOT NULL DEFAULT 0, description TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS stage_rooms(
      id INTEGER PRIMARY KEY AUTOINCREMENT, stageId INTEGER NOT NULL REFERENCES tournament_stages(id) ON DELETE CASCADE,
      jornada INTEGER NOT NULL, matchup TEXT NOT NULL, ordinal INTEGER NOT NULL, label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stage_results(
      roomId INTEGER NOT NULL REFERENCES stage_rooms(id) ON DELETE CASCADE, teamId INTEGER NOT NULL REFERENCES teams(id),
      placement INTEGER NOT NULL CHECK(placement>=1 AND placement<=12), kills INTEGER NOT NULL CHECK(kills>=0 AND kills<=99),
      PRIMARY KEY(roomId,teamId), UNIQUE(roomId,placement)
    );
    CREATE TABLE IF NOT EXISTS staff_accounts(
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL COLLATE NOCASE, passwordHash TEXT NOT NULL,
      displayName TEXT NOT NULL, instagram TEXT DEFAULT '', photo TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      showPublic INTEGER NOT NULL DEFAULT 1, lastLogin TEXT DEFAULT '', lastIp TEXT DEFAULT '', createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_people(
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL CHECK(type IN ('moderator','caster')), displayName TEXT NOT NULL,
      instagram TEXT DEFAULT '', photo TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sortOrder INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_players_team ON players(teamId);
    CREATE INDEX IF NOT EXISTS idx_stage_results_team ON stage_results(teamId);
    CREATE INDEX IF NOT EXISTS idx_stage_rooms_stage ON stage_rooms(stageId);
  `);

  ensureColumn('tournament_stages','groupCount','INTEGER NOT NULL DEFAULT 1');
  ensureColumn('tournament_stages','groupSize','INTEGER NOT NULL DEFAULT 12');
  ensureColumn('tournament_stages','qualificationMode',"TEXT NOT NULL DEFAULT 'overall'");
  ensureColumn('tournament_stages','qualifiersPerGroup','INTEGER NOT NULL DEFAULT 0');
  ensureColumn('tournament_stages','roomMode',"TEXT NOT NULL DEFAULT 'all'");
  ensureColumn('tournament_stages','isFinal','INTEGER NOT NULL DEFAULT 0');

  transaction(() => {
    for (const [k, v] of Object.entries(defaults)) exec('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING', [k, v]);
    seedStagesInternal();
    const stages = all('SELECT * FROM tournament_stages ORDER BY sortOrder,id');
    if (stages.length) {
      stages.forEach((s,i)=>{
        const isLast=i===stages.length-1;
        const isSemi=/SEMIFINAL/i.test(String(s.name||''));
        if(isLast){
          exec("UPDATE tournament_stages SET isFinal=1,groupCount=1,groupSize=12,roomMode='all',matchups='FINAL',qualificationMode='overall',qualifiersPerGroup=0 WHERE id=?",[s.id]);
        }else if(isSemi){
          exec("UPDATE tournament_stages SET isFinal=0,groupCount=3,groupSize=6,roomMode='cross',qualificationMode='overall',qualifiersPerGroup=0 WHERE id=?",[s.id]);
        }else{
          const p=Number(s.participantCount||0);const g=p>=12&&p%12===0?Math.max(1,Math.min(10,p/12)):Math.max(1,Number(s.groupCount)||1);
          const q=Number(s.qualifiers||0);const qpg=q>0&&q%g===0?Math.min(12,q/g):Number(s.qualifiersPerGroup||0);
          exec("UPDATE tournament_stages SET isFinal=0,groupCount=?,groupSize=?,roomMode=CASE WHEN roomMode='all' THEN 'groups' ELSE roomMode END,qualificationMode=CASE WHEN ? > 0 THEN 'per_group' ELSE qualificationMode END,qualifiersPerGroup=CASE WHEN ? > 0 THEN ? ELSE qualifiersPerGroup END WHERE id=?",[g,Math.ceil(p/g)||12,qpg,qpg,qpg,s.id]);
        }
      });
    }
    const c = config();
    const first = one('SELECT groupCount FROM tournament_stages WHERE enabled=1 ORDER BY sortOrder,id LIMIT 1');
    ensureTeamsInternal(Number(c.teamCount || 36), Number(first?.groupCount || c.groupCount || 3));
    if (!one('SELECT id FROM stage_rooms LIMIT 1')) buildRoomsInternal();
    if (!one('SELECT id FROM production_people LIMIT 1')) {
      exec("INSERT INTO production_people(type,displayName,instagram,sortOrder) VALUES('moderator','MODERADOR 01','',1)");
      exec("INSERT INTO production_people(type,displayName,instagram,sortOrder) VALUES('moderator','MODERADOR 02','',2)");
      exec("INSERT INTO production_people(type,displayName,instagram,sortOrder) VALUES('caster','CASTER 01','',1)");
      exec("INSERT INTO production_people(type,displayName,instagram,sortOrder) VALUES('caster','CASTER 02','',2)");
    }
  });

  const adminUser = (process.env.ADMIN_USER || '').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!adminUser || adminPassword.length < 12 || jwtSecret.length < 32) throw new Error('Configura ADMIN_USER, ADMIN_PASSWORD (12+ caracteres) y JWT_SECRET (32+ caracteres) en .env antes de iniciar.');
  const currentAdmin = one("SELECT id,username,passwordHash FROM users WHERE role='admin' LIMIT 1");
  if (!currentAdmin) {
    if (one('SELECT id FROM users WHERE username=?',[adminUser]) || one('SELECT id FROM staff_accounts WHERE username=?',[adminUser])) throw new Error(`El usuario de administrador “${adminUser}” ya está siendo usado.`);
    run("INSERT INTO users(username,passwordHash,role,createdAt) VALUES(?,?,'admin',?)", [adminUser,bcrypt.hashSync(adminPassword,12),new Date().toISOString()]);
    console.log(`Administrador creado: ${adminUser}`);
  } else {
    const duplicate = one('SELECT id FROM users WHERE username=? AND id!=?',[adminUser,currentAdmin.id]) || one('SELECT id FROM staff_accounts WHERE username=?',[adminUser]);
    if (duplicate) throw new Error(`El usuario de administrador “${adminUser}” ya está siendo usado.`);
    if (currentAdmin.username !== adminUser || !bcrypt.compareSync(adminPassword,currentAdmin.passwordHash)) {
      run('UPDATE users SET username=?,passwordHash=? WHERE id=?',[adminUser,bcrypt.hashSync(adminPassword,12),currentAdmin.id]);
      console.log(`Administrador sincronizado desde .env: ${adminUser}`);
    }
  }
  persist();
}
