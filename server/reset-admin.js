import 'dotenv/config';
import bcrypt from 'bcryptjs';
import {initDb,one,run} from './database.js';

async function resetAdmin(){
  const username=process.env.ADMIN_USER?.trim();
  const password=process.env.ADMIN_PASSWORD;
  if(!username||!password||password.length<12) throw new Error('Configura ADMIN_USER y ADMIN_PASSWORD (12+ caracteres) en .env.');
  await initDb();
  const admin=one("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if(!admin) throw new Error('No se encontró la cuenta de administrador.');
  const duplicate=one('SELECT id FROM users WHERE username=? AND id!=?',[username,admin.id]);
  if(duplicate) throw new Error('Ese nombre de usuario ya pertenece a otra cuenta.');
  run('UPDATE users SET username=?,passwordHash=? WHERE id=?',[username,bcrypt.hashSync(password,12),admin.id]);
  console.log('ADMINISTRADOR ACTUALIZADO CORRECTAMENTE');
  console.log('Usuario:',username);
}
resetAdmin().catch(error=>{console.error('ERROR:',error.message);process.exitCode=1;});
