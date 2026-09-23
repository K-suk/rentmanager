'use client';
import { useState, type FormEvent } from 'react';
type Employee={name:string;role:string};
export default function Home() {
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [employee,setEmployee]=useState<Employee|null>(null);
  async function login(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setMessage(''); const data=new FormData(event.currentTarget);
    try {
      const response=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')}),signal:AbortSignal.timeout(15000)});
      if(!response.ok) {setMessage(response.status===429?'試行回数が上限に達しました。5分ほど待って再試行してください。':'ログインできませんでした。入力内容をご確認ください。');return;}
      const me=await fetch('/api/me',{cache:'no-store'}); if(!me.ok) throw new Error(); setEmployee((await me.json()).employee);
    } catch {setMessage('接続できませんでした。しばらくしてから再試行してください。');} finally {setBusy(false);}
  }
  async function logout() {
    setBusy(true);setMessage('');
    try {const result=await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)}); if(!result.ok)throw new Error();setEmployee(null);}catch{setMessage('ログアウトできませんでした。再試行してください。');}finally{setBusy(false);}
  }
  return <main><header><span className="brand">RentManager</span><span className="badge">公開デモ・準備中</span></header><section className="card"><p className="eyebrow">備品貸出管理</p><h1>{employee?'ログインしました':'おかえりなさい'}</h1><p className="intro">{employee?`${employee.name}さん、認証を確認できました。貸出機能は準備中です。`:'デモ社員のアカウントでログインしてください。'}</p>{employee?<button onClick={logout} disabled={busy}>{busy?'処理中…':'ログアウト'}</button>:<form onSubmit={login}><label htmlFor="email">メールアドレス</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254}/><label htmlFor="password">パスワード</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128}/><button disabled={busy}>{busy?'ログイン中…':'ログイン'}</button></form>}<p role="status" aria-live="polite" className="message">{message}</p><aside>架空の社員・備品を使うデモです。<br/>実在する個人情報は入力しないでください。</aside></section><footer>社員の追加は管理者が行います。</footer></main>;
}
