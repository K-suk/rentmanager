import { randomUUID, createHmac } from 'node:crypto';
import { db, origin, secret } from '../../src/lib/db.ts';
import { rateLimit } from '../../src/lib/security.ts';
import { APIError } from 'better-auth/api';
import { assertTestDatabase } from '../db/test-guard.ts';
import { auth } from '../../src/lib/auth.ts';

// Mutates only newly generated fixtures on the explicitly acknowledged dev DB.
// Public/protected identities are only attacked through guarded APIs; SQL trigger tests roll back.
const ids: string[]=[]; let failures=0;
let savedLogin: {key:string;count:number;expires_at:Date} | undefined;let isolatedLoginKey: string | undefined;
function check(condition:unknown,label:string) { if(!condition) {failures++; console.log(`FAIL ${label}`);} else console.log(`PASS ${label}`); }
async function call(path:string,method='GET',body:unknown=undefined,cookie='',requestOrigin:string|null=origin()) {
  const headers=new Headers(); if(body!==undefined)headers.set('Content-Type','application/json'); if(cookie)headers.set('Cookie',cookie); if(requestOrigin!==null)headers.set('Origin',requestOrigin);
  return fetch(`${origin()}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});
}
function cookieOf(response:Response) {return response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
async function signIn(email:string,password:string) {return call('/api/auth/sign-in/email','POST',{email,password});}
try {
  if(process.env.RENTMANAGER_PROBE_ACK!=='rentmanager-app-dev-only' || !/^http:\/\/localhost:310[1-9]$/.test(origin()))throw new Error('Scope');
  const identity=await db().query("SELECT value FROM app_environment WHERE key='purpose'");
  if(identity.rows[0]?.value==='rentmanager-test') await assertTestDatabase(db());
  else if(identity.rows[0]?.value!=='rentmanager-app-dev')throw new Error('Scope');
  isolatedLoginKey=createHmac('sha256',secret()).update('login:local-loopback').digest('hex');
  savedLogin=(await db().query('SELECT * FROM app_rate_limit WHERE key=$1',[isolatedLoginKey])).rows[0];
  await db().query('DELETE FROM app_rate_limit WHERE key=$1',[isolatedLoginKey]);
  const email=process.env.BOOTSTRAP_ADMIN_EMAIL || ''; const password=process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  const admin=await signIn(email,password); check(admin.status===200,'protected admin email/password login');
  const cookie=cookieOf(admin); if(!cookie)throw new Error('No session');
  check(admin.headers.getSetCookie().some(x=>/httponly/i.test(x)&&/samesite=lax/i.test(x)),'HttpOnly SameSite=Lax cookie');
  const payload=await admin.json();check(!('token' in payload),'token not returned in JSON');
  const me=await call('/api/me','GET',undefined,cookie); check(me.status===200,'authenticated active employee');
  const adminId=(await me.json()).employee.id as string;
  check((await call('/api/me')).status===401,'anonymous data rejected');
  check((await signIn(email,randomUUID())).status===401,'wrong password rejected');
  const attacks:Record<string,unknown>={
    '/sign-up/email':{email:`rm-probe-${randomUUID()}@example.com`,password:randomUUID(),name:'Probe'},
    '/update-user':{name:'Changed'},'/change-password':{currentPassword:password,newPassword:randomUUID(),revokeOtherSessions:true},
    '/set-password':{newPassword:randomUUID()},'/change-email':{newEmail:`rm-probe-${randomUUID()}@example.com`},'/delete-user':{password},
    '/request-password-reset':{email,redirectTo:origin()},'/reset-password':{newPassword:randomUUID(),token:randomUUID()},
    '/send-verification-email':{email},'/email-otp/send-verification-otp':{email,type:'sign-in'},'/sign-in/email-otp':{email,otp:'123456'},
    '/sign-in/magic-link':{email},'/sign-in/social':{provider:'google'},'/link-social':{provider:'google'},'/unlink-account':{providerId:'credential'},
    '/admin/create-user':{email:`rm-probe-${randomUUID()}@example.com`,password:randomUUID(),name:'Probe'},
    '/admin/set-user-password':{userId:adminId,newPassword:randomUUID()},'/admin/remove-user':{userId:adminId},
    '/organization/invite-member':{email,role:'member'},'/revoke-sessions':{},'/delete-user/callback':{token:randomUUID()}
  };
  for(const [path,body] of Object.entries(attacks)) {
    for(const suppliedOrigin of [origin(),null,'https://attacker.invalid']) {
      const response=await call(`/api/auth${path}`,'POST',body,cookie,suppliedOrigin);
      check(response.status===403 && (await response.json()).error==='ENDPOINT_DISABLED',`direct ${path} blocked (${suppliedOrigin===origin()?'trusted':suppliedOrigin===null?'omitted':'foreign'})`);
    }
  }
  check((await call('/api/auth/change-password','GET',undefined,cookie)).status===403,'GET mutation variant blocked');
  check((await call('/api/auth/sign-in/email','GET')).status===405,'wrong login method rejected');
  for(const invalidOrigin of [null,'https://attacker.invalid']) check((await call('/api/auth/sign-in/email','POST',{email,password},'',invalidOrigin)).status===403,'login missing/foreign Origin rejected');
  check((await call('/api/employees','POST',{},cookie,'https://attacker.invalid')).status===403,'employee write CSRF rejected');
  check((await call('/api/employees','PATCH',{id:adminId,active:false,role:'employee'},cookie)).status===403,'protected admin app modification denied');
  // Library API bypass (not just the HTTP wrapper).
  try { await auth().api.changePassword({headers:new Headers({Cookie:cookie}),body:{currentPassword:password,newPassword:randomUUID()}}); check(false,'library direct changePassword blocked'); } catch(error) {check(error instanceof APIError && error.status==='FORBIDDEN','library direct changePassword blocked');}
  const client=await db().connect();
  try {
    await client.query('BEGIN');
    for(const [label,sql] of [
      ['user update','UPDATE "user" SET name=\'Changed\' WHERE id=$1'],['user delete','DELETE FROM "user" WHERE id=$1'],
      ['credential update','UPDATE account SET password=\'Changed\' WHERE "userId"=$1'],['credential delete','DELETE FROM account WHERE "userId"=$1'],
      ['employee update','UPDATE employee SET name=\'Changed\' WHERE auth_user_id=$1'],['employee delete','DELETE FROM employee WHERE auth_user_id=$1']
    ]) {
      await client.query('SAVEPOINT attack'); let protectedError=false;
      try {await client.query(sql,[adminId]);} catch(error) {protectedError=(error as {code:string}).code==='P0001';}
      await client.query('ROLLBACK TO SAVEPOINT attack'); check(protectedError,`DB protected ${label}`);
    }
    await client.query('ROLLBACK');
  } finally {client.release();}
  const fixtureEmail=`rm-probe-${randomUUID()}@example.com`;const fixturePassword=randomUUID();
  const created=await call('/api/employees','POST',{email:fixtureEmail,password:fixturePassword,name:'検証専用社員',role:'employee'},cookie);
  check(created.status===201,'admin creates fictional employee without mail');
  const createdBody=await created.json(); if(!createdBody.id)throw new Error('Fixture'); const id=createdBody.id as string;ids.push(id);
  const employeeLogin=await signIn(fixtureEmail,fixturePassword);check(employeeLogin.status===200,'new employee logs in without verification'); const employeeCookie=cookieOf(employeeLogin);
  check((await call('/api/employees','POST',{email:`rm-probe-${randomUUID()}@example.com`,password:randomUUID(),name:'拒否',role:'admin'},employeeCookie)).status===403,'ordinary employee cannot provision');
  check((await call('/api/employees','POST',{})).status===401,'anonymous cannot provision');
  check((await call('/api/employees','PATCH',{id,active:true,role:'admin'},cookie)).status===200,'admin promotes fixture');
  const promoted=await call('/api/me','GET',undefined,employeeCookie);check((await promoted.json()).employee.role==='admin','existing session observes promotion');
  check((await call('/api/employees','PATCH',{id,active:true,role:'employee'},cookie)).status===200,'admin downgrades fixture');
  check((await call('/api/employees','POST',{email:`rm-probe-${randomUUID()}@example.com`,password:randomUUID(),name:'拒否',role:'admin'},employeeCookie)).status===403,'downgraded existing session cannot provision');
  check((await call('/api/employees','PATCH',{id,active:false,role:'employee'},cookie)).status===200,'admin disables fixture');
  check((await call('/api/me','GET',undefined,employeeCookie)).status===403,'existing disabled session rejected immediately');
  check((await call('/api/auth/get-session','GET',undefined,employeeCookie)).status===403,'disabled auth session endpoint rejected');
  check((await signIn(fixtureEmail,fixturePassword)).status===403,'disabled new login rejected');
  check((await call('/api/employees','PATCH',{id,active:true,role:'employee'},cookie)).status===403,'reactivation not offered');
  await db().query('DELETE FROM employee WHERE auth_user_id=$1 AND NOT protected',[id]);
  check((await call('/api/me','GET',undefined,employeeCookie)).status===403,'unregistered existing session rejected');
  check((await signIn(fixtureEmail,fixturePassword)).status===403,'unregistered new login rejected');
  const fresh=await signIn(email,password);check(fresh.status===200,'protected credentials still work after attacks');const logoutCookie=cookieOf(fresh);
  check((await call('/api/auth/sign-out','POST',{},logoutCookie)).status===200,'logout succeeds');
  check((await call('/api/me','GET',undefined,logoutCookie)).status===401,'copied cookie rejected after logout');
  const rateIdentity=`probe-${randomUUID()}`;const key=createHmac('sha256',secret()).update(`write:${rateIdentity}`).digest('hex');
  const attempts=await Promise.allSettled(Array.from({length:65},()=>rateLimit('write',rateIdentity)));
  check(attempts.filter(x=>x.status==='fulfilled').length===60,'shared concurrent write limit exactly 60');
  await db().query('DELETE FROM app_rate_limit WHERE key=$1',[key]);
  check((await call('/api/auth/sign-out','POST',{},cookie)).status===200,'probe admin session cleanup');
  const loginKey=createHmac('sha256',secret()).update('login:local-loopback').digest('hex');
  const previous=await db().query('SELECT * FROM app_rate_limit WHERE key=$1',[loginKey]);
  try {
    await db().query('DELETE FROM app_rate_limit WHERE key=$1',[loginKey]);
    const unknownEmail=`rm-probe-${randomUUID()}@example.com`;
    for(let n=1;n<=20;n++) check((await signIn(unknownEmail,randomUUID())).status===401,`login/IP attempt ${n} admitted`);
    const limited=await signIn(unknownEmail,randomUUID());check(limited.status===429 && limited.headers.has('Retry-After'),'login/IP attempt 21 limited');
    const spoof=await fetch(`${origin()}/api/auth/sign-in/email`,{method:'POST',headers:{Origin:origin(),'Content-Type':'application/json','x-forwarded-for':'203.0.113.9','x-vercel-forwarded-for':'203.0.113.8','x-real-ip':'203.0.113.7'},body:JSON.stringify({email:unknownEmail,password:randomUUID()}),signal:AbortSignal.timeout(20000)});
    check(spoof.status===429,'spoofed forwarding headers do not bypass local IP limit');
    await db().query("UPDATE app_rate_limit SET expires_at=now()-interval '1 second' WHERE key=$1",[loginKey]);
    check((await signIn(unknownEmail,randomUUID())).status===401,'login window expiry allows next attempt');
  } finally {
    await db().query('DELETE FROM app_rate_limit WHERE key=$1',[loginKey]);
    if(previous.rowCount) await db().query('INSERT INTO app_rate_limit(key,count,expires_at) VALUES($1,$2,$3)',[loginKey,previous.rows[0].count,previous.rows[0].expires_at]);
  }

} catch { failures++;console.log('FAIL suite stopped; sensitive details suppressed'); }
finally {
  for(const id of ids) {
    const client=await db().connect();
    try {await client.query('BEGIN');await client.query('DELETE FROM session WHERE "userId"=$1',[id]);await client.query('DELETE FROM employee WHERE auth_user_id=$1 AND NOT protected',[id]);await client.query('DELETE FROM account WHERE "userId"=$1',[id]);await client.query('DELETE FROM "user" WHERE id=$1 AND email LIKE \'rm-probe-%@example.com\'',[id]);await client.query('COMMIT');}
    catch {await client.query('ROLLBACK');failures++;console.log('FAIL fixture cleanup');}finally{client.release();}
  }
  if(isolatedLoginKey) {
    await db().query('DELETE FROM app_rate_limit WHERE key=$1',[isolatedLoginKey]);
    if(savedLogin) await db().query('INSERT INTO app_rate_limit(key,count,expires_at) VALUES($1,$2,$3)',[savedLogin.key,savedLogin.count,savedLogin.expires_at]);
  }
  await db().end();process.exitCode=failures?1:0;console.log(failures?'FAIL acceptance incomplete':'PASS all live acceptance checks');
}
