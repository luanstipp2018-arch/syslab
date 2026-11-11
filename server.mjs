import {reservationList,changeReservation} from './reservations.mjs';
import { createServer } from 'node:http';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

for (const key of ['APP_URL', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'ADMIN_PASSWORD_HASH']) {
  if (!process.env[key]?.trim()) throw new Error(`Configure ${key}.`);
}
const origin = new URL(process.env.APP_URL).origin;
if (!origin.startsWith('https://') && new URL(origin).hostname !== 'localhost') {
  throw new Error('APP_URL precisa usar HTTPS fora de localhost.');
}
const adminHash = process.env.ADMIN_PASSWORD_HASH.trim();
if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(adminHash)) {
  throw new Error('Configure ADMIN_PASSWORD_HASH conforme o README.');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  charset: 'utf8mb4',
  timezone: 'Z',
  connectionLimit: 8,
});
const schema = readFileSync(new URL('./schema.sql', import.meta.url),'utf8').replace(/^﻿/,'');
for (const statement of schema.split(';').filter(sql=>sql.trim())) await pool.query(statement);

async function rows(db,sql,...args) {
  const [result] = await db.execute(sql,args);
  return result;
}
async function one(db,sql,...args) {
  return (await rows(db,sql,...args))[0];
}
await rows(pool,"INSERT IGNORE INTO users(email,name,role) VALUES ('admin','Administrador','ti')");
await rows(pool,"INSERT IGNORE INTO passwords VALUES ('admin',?)",adminHash);
function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt+':'+scryptSync(password,salt,64).toString('hex');
}


const roles = { aluno: 'Aluno', professor: 'Professor', resp: 'Responsável pelo laboratório', ti: 'Administrador de TI' };
const portal = readFileSync(new URL('./portal.html', import.meta.url), 'utf8');
const portalScript = readFileSync(new URL('./assets/portal.js', import.meta.url));
const wordmark = readFileSync(new URL('./assets/syslab.png', import.meta.url));
const stylesheets = new Map(['portal', 'login', 'status', 'usuarios'].map(name => [
  `/assets/${name}.css`,
  readFileSync(new URL(`./assets/${name}.css`, import.meta.url)),
]));
const fontStyles = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap">';
const digest = token => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('hex');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cookie = (value, seconds) => `syslab_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin.startsWith('https:') ? '; Secure' : ''}`;
const redirect = (res, path) => res.writeHead(303, {Location:path}).end();
const form = (action, content) => `<form action="${action}" method="post">${content}</form>`;
function loginPage(res, error = '', status = 200) {
  res.writeHead(status, {'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Entrar no SysLab</title>
  ${fontStyles}<link rel="stylesheet" href="/assets/login.css">
</head>
<body>
  <main>
    <div class="brand">
      <img class="logo" src="/assets/syslab.png" alt="SysLab">
      <p class="caption">Portal dos laboratórios</p>
    </div>
    <section class="access" aria-labelledby="login-title">
      <div class="panel">
        <h1 id="login-title">Entrar no SysLab</h1>
        ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
        <form action="/entrar" method="post">
          <div class="field">
            <label for="login">E-mail ou usuário</label>
            <input id="login" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required>
          </div>
          <div class="field">
            <label for="password">Senha</label>
            <div class="password">
              <input id="password" type="password" name="password" autocomplete="current-password" maxlength="256" required>
              <button class="toggle" id="toggle-password" type="button" aria-controls="password" hidden>Mostrar</button>
            </div>
          </div>
          <button class="submit" type="submit">Entrar</button>
        </form>
        <p class="help">Precisa de acesso? Fale com o administrador.</p>
      </div>
    </section>
  </main>
  <script>
    const password = document.getElementById('password');
    const toggle = document.getElementById('toggle-password');
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const showing = password.type === 'password';
      password.type = showing ? 'text' : 'password';
      toggle.textContent = showing ? 'Ocultar' : 'Mostrar';
    });
  </script>
</body>
</html>`);
}
function page(res, title, content, status = 200) {
  res.writeHead(status, {'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)} · SysLab</title>${fontStyles}<link rel="stylesheet" href="/assets/status.css"></head><body><header><img class="brand-logo" src="/assets/syslab.png" alt="SysLab"></header>
  <main><h1>${escape(title)}</h1>${content || '<a href="/">Voltar ao portal</a>'}</main></body></html>`);
}
async function withinLimit(db,key,max,now) {
  await db.beginTransaction();
  try {
    await rows(db,`INSERT INTO limits VALUES (?,1,?) ON DUPLICATE KEY UPDATE
      attempts=IF(expires<=?,1,attempts+1), expires=IF(expires<=?, ?, expires)`,key,now+900,now,now,now+900);
    const row = await one(db,'SELECT attempts FROM limits WHERE id=?',key);
    await db.commit();
    return row.attempts <= max;
  } catch(error) {
    await db.rollback();
    throw error;
  }
}
async function readForm(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > 8192) throw new Error('Formulário muito grande');
  }
  return new URLSearchParams(body);
}
function emailField() {
  return '<label>E-mail <input type="email" name="email" maxlength="254" required></label>';
}
async function usersPage(db,res,setupUrl='') {
  const accounts = await rows(db,"SELECT u.*, p.email AS password_set FROM users u LEFT JOIN passwords p ON p.email=u.email WHERE u.email<>'admin' ORDER BY u.name,u.email");
  const list = accounts.map(u => `<li class="account">
    <div><strong>${escape(u.name)}</strong><span>${escape(u.email)}</span><span>RA ${escape(u.ra ?? 'pendente')} · ${roles[u.role]}</span></div>
    <div class="actions"><span class="status ${u.active?'active':''}">${!u.active?'Inativo':u.password_set?'Ativo':'Primeiro acesso'}</span>
    ${form('/usuarios/status', `<input type="hidden" name="email" value="${escape(u.email)}"><input type="hidden" name="active" value="${u.active?0:1}"><button class="secondary">${u.active?'Desativar':'Reativar'}</button>`)}
    ${u.active&&!u.password_set?form('/usuarios/primeiro-acesso',`<input type="hidden" name="email" value="${escape(u.email)}"><button class="secondary">Novo link</button>`):''}</div>
  </li>`).join('');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Usuários · SysLab</title>
  ${fontStyles}<link rel="stylesheet" href="/assets/usuarios.css"></head><body>
  <header><div><img class="brand-logo" src="/assets/syslab.png" alt="SysLab"><a href="/">Voltar ao portal</a></div></header>
  <main><h1>Usuários</h1>
  ${setupUrl?`<section><label>Link de primeiro acesso <input readonly value="${escape(setupUrl)}" onfocus="this.select()"></label><p>Envie este link apenas ao usuário cadastrado. Ele vale por 48 horas e pode ser usado uma vez.</p></section>`:''}
  <div class="layout">
  <section><h2>Cadastrar usuário</h2>
    ${form('/usuarios', `<label>Nome <input name="name" maxlength="120" required></label>
    ${emailField()}<label>RA <input name="ra" maxlength="32" required></label>
    <label>Perfil <select name="role">${Object.entries(roles).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>
    <button class="primary">Cadastrar</button>`)}
  </section><section><h2>Contas cadastradas</h2>${list?`<ul>${list}</ul>`:'<p>Nenhuma conta cadastrada.</p>'}</section>
  </div></main></body></html>`);
}

async function issueFirstAccess(db,email,now) {
  const code = token();
  await rows(db,`INSERT INTO first_access(email,token_hash,expires) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE token_hash=?,expires=?`,email,digest(code),now+172800,digest(code),now+172800);
  return origin+'/primeiro-acesso?codigo='+code;
}
function firstAccessPage(res,code,error='',status=200) {
  page(res,'Defina sua senha',`${error?`<p role="alert">${escape(error)}</p>`:''}
    ${form('/primeiro-acesso',`<input type="hidden" name="codigo" value="${escape(code)}">
      <p><label>Nova senha <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label></p>
      <p><label>Confirme a senha <input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label></p>
      <p>Use pelo menos 12 caracteres.</p><button type="submit">Definir senha</button>`)}`,status);
}
async function completeFirstAccess(db,res,data,now) {
  const code = data.get('codigo') || '';
  const password = data.get('password') || '';
  if (!/^[a-f0-9]{64}$/.test(code)) return page(res,'Link inválido','',400);
  if (password.length<12 || password.length>256 || password!==data.get('confirmation')) {
    return firstAccessPage(res,code,'Confira a confirmação e use pelo menos 12 caracteres.',400);
  }
  await db.beginTransaction();
  try {
    const setup = await one(db,`SELECT f.email FROM first_access f JOIN users u ON u.email=f.email
      WHERE f.token_hash=? AND f.expires>? AND u.active=1 FOR UPDATE`,digest(code),now);
    if (!setup) {
      await db.rollback();
      return page(res,'Link inválido ou expirado','<p>Peça um novo link ao administrador.</p><a href="/">Voltar ao login</a>',400);
    }
    await rows(db,'INSERT INTO passwords VALUES (?,?)',setup.email,passwordHash(password));
    await rows(db,'DELETE FROM first_access WHERE email=?',setup.email);
    await db.commit();
    return redirect(res,'/');
  } catch(error) {
    await db.rollback();
    throw error;
  }
}
async function stockSnapshot(db, showMovements) {
  const items = await rows(db,'SELECT * FROM materials ORDER BY id');
  const moves = showMovements ? await rows(db,`SELECT m.*, u.name AS actor_name FROM stock_movements m
    JOIN users u ON u.email=m.actor ORDER BY m.id DESC LIMIT 1000`) : [];
  return {
    itens:items.map(item=>({...item,id:'MC-'+String(item.id).padStart(2,'0')})),
    movs:moves.reverse().map(move=>({
      id:'MV-'+move.id,itemId:'MC-'+String(move.material_id).padStart(2,'0'),
      tipo:move.tipo,qtd:move.qtd,em:move.em.toISOString(),actorName:move.actor_name,
      obs:move.obs,resId:move.reservation_code || '',
    })),
  };
}

function json(res,status,payload) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(payload));
}

const canManageStock = user => user?.role === 'resp' || user?.role === 'ti';

async function changeStock(db,res,user,path,data) {
  if (!canManageStock(user)) return json(res,403,{error:'Acesso restrito ao responsável e à administração de TI.'});
  const quantityText = data.get('qtd') || '';
  const qtd = Number(quantityText);
  if (!/^\d+$/.test(quantityText) || !Number.isSafeInteger(qtd) || qtd > 1_000_000_000) {
    return json(res,400,{error:'Informe uma quantidade inteira válida.'});
  }
  await db.beginTransaction();
  try {
    let id;
    if (path === '/estoque/material') {
      const nome = (data.get('nome') || '').trim();
      const cat = (data.get('cat') || '').trim();
      const un = data.get('un');
      const local = (data.get('local') || '').trim() || 'Não informado';
      const minimum = data.get('min') || '';
      if (!nome || nome.length>180 || !cat || cat.length>80 || local.length>180 ||
          !['un','m','rolo','pacote'].includes(un) || !/^\d+$/.test(minimum) || Number(minimum)>1_000_000_000) {
        await db.rollback();
        return json(res,400,{error:'Confira os dados do material.'});
      }
      const result = await rows(db,'INSERT INTO materials(nome,cat,un,local,qtd,min) VALUES (?,?,?,?,?,?)',
        nome,cat,un,local,qtd,Number(minimum));
      id = result.insertId;
      if (qtd) await rows(db,`INSERT INTO stock_movements(material_id,tipo,qtd,obs,actor)
        VALUES (?,'entrada',?,'Cadastro inicial',?)`,id,qtd,user.email);
    } else {
      const itemCode = data.get('itemId') || '';
      const tipo = data.get('tipo');
      const obs = (data.get('obs') || '').trim() || (tipo==='entrada'?'Entrada':'Saída');
      const reservation = data.get('resId') || '';
      if (!/^MC-\d{1,10}$/.test(itemCode) || !['entrada','saida'].includes(tipo) || !qtd ||
          obs.length>500 || (reservation && !/^R-\d{1,20}$/.test(reservation))) {
        await db.rollback();
        return json(res,400,{error:'Confira os dados da movimentação.'});
      }
      id = Number(itemCode.slice(3));
      const item = await one(db,'SELECT qtd FROM materials WHERE id=? FOR UPDATE',id);
      const balance = (item?.qtd ?? 0)+(tipo==='entrada'?qtd:-qtd);
      if (!item || balance<0 || balance>1_000_000_000) {
        await db.rollback();
        return json(res,409,{error:'Material indisponível ou saldo insuficiente.'});
      }
      await rows(db,'UPDATE materials SET qtd=? WHERE id=?',balance,id);
      await rows(db,`INSERT INTO stock_movements(material_id,tipo,qtd,obs,actor,reservation_code)
        VALUES (?,?,?,?,?,?)`,id,tipo,qtd,obs,user.email,reservation || null);
    }
    await db.commit();
    return json(res,200,{id:'MC-'+String(id).padStart(2,'0')});
  } catch(error) {
    await db.rollback();
    throw error;
  }
}

createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '));
  if (origin.startsWith('https:')) {
    res.setHeader('Strict-Transport-Security','max-age=31536000');
  }
  let db;
  try {
    const url = new URL(req.url,origin);
    if (url.pathname === '/assets/syslab.png' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, {'Content-Type':'image/png'});
      return res.end(req.method === 'HEAD' ? undefined : wordmark);
    }
    if (url.pathname === '/assets/portal.js' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8'});
      return res.end(req.method === 'HEAD' ? undefined : portalScript);
    }
    const stylesheet = stylesheets.get(url.pathname);
    if (stylesheet && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, {'Content-Type':'text/css; charset=utf-8'});
      return res.end(req.method === 'HEAD' ? undefined : stylesheet);
    }
    db = await pool.getConnection();
    const now = Math.floor(Date.now()/1000);
    const sessionToken = req.headers.cookie?.match(/(?:^|; *)syslab_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const sessionHash = sessionToken && digest(sessionToken);
    const user = sessionHash && await one(db,`SELECT u.* FROM sessions s JOIN users u ON u.email=s.email
      WHERE s.hash=? AND s.expires>? AND u.active=1`,sessionHash,now);
    if (req.method === 'POST') {
      if (req.headers.origin !== origin) return page(res,'Solicitação inválida','',403);
      const data = await readForm(req);
      if (['/reservas/solicitar','/reservas/decidir'].includes(url.pathname)) {
        try {
          return json(res,200,await changeReservation(db,user,url.pathname,data));
        } catch(error) {
          if(error.status)return json(res,error.status,{error:error.message});
          throw error;
        }
      }
      if (['/estoque/material','/estoque/movimentacao'].includes(url.pathname)) {
        return await changeStock(db,res,user,url.pathname,data);
      }
      const email = (data.get('email') || '').trim().toLowerCase();
      const validEmail = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (url.pathname === '/primeiro-acesso') return await completeFirstAccess(db,res,data,now);
      if (url.pathname === '/entrar') {
        const login = (data.get('login') || '').trim().toLowerCase();
        const password = data.get('password') || '';
        await rows(db,'DELETE FROM limits WHERE expires<=?',now);
        await rows(db,'DELETE FROM sessions WHERE expires<=?',now);
        if (password.length > 256 || login.length > 254 ||
            !(await withinLimit(db,'ip:'+req.socket.remoteAddress,60,now)) ||
            !(await withinLimit(db,'login:'+digest(login),8,now))) {
          return loginPage(res,'Aguarde antes de tentar novamente.',429);
        }
        const account = await one(db,`SELECT p.hash FROM passwords p JOIN users u USING(email)
          WHERE u.email=? AND u.active=1`,login);
        const [salt,key] = (account?.hash ?? adminHash).split(':');
        const correct = timingSafeEqual(scryptSync(password,salt,64),Buffer.from(key,'hex'));
        if (!account || !correct) {
          return loginPage(res,'Usuário ou senha inválidos.',401);
        }
        if (sessionHash) await rows(db,'DELETE FROM sessions WHERE hash=?',sessionHash);
        const session = token();
        await rows(db,'INSERT INTO sessions VALUES (?,?,?)',digest(session),login,now+28800);
        res.setHeader('Set-Cookie',cookie(session,28800));
        return redirect(res,'/');
      }
      if (url.pathname === '/sair') {
        if (sessionHash) await rows(db,'DELETE FROM sessions WHERE hash=?',sessionHash);
        res.setHeader('Set-Cookie',cookie('',0));
        return redirect(res,'/');
      }
      if (['/usuarios','/usuarios/status','/usuarios/primeiro-acesso'].includes(url.pathname)) {
        if (user?.role !== 'ti') return page(res,'Acesso restrito','<a href="/">Voltar</a>',403);
        if (url.pathname === '/usuarios/primeiro-acesso') {
          await db.beginTransaction();
          try {
            const account = await one(db,`SELECT u.email,p.email AS password_set FROM users u LEFT JOIN passwords p ON p.email=u.email
              WHERE u.email=? AND u.active=1 FOR UPDATE`,email);
            if (!account || account.password_set) {
              await db.rollback();
              return page(res,'Conta indisponível para primeiro acesso','<a href="/usuarios">Voltar</a>',409);
            }
            const link = await issueFirstAccess(db,email,now);
            await db.commit();
            return await usersPage(db,res,link);
          } catch(error) {
            await db.rollback();
            throw error;
          }
        }
        if (url.pathname === '/usuarios/status') {
          const active = data.get('active') === '1' ? 1 : 0;
          await db.beginTransaction();
          try {
            await rows(db,"UPDATE users SET active=? WHERE email=? AND email<>'admin'",active,email);
            if (!active) {
              await rows(db,'DELETE FROM first_access WHERE email=? AND EXISTS (SELECT 1 FROM users WHERE email=? AND active=0)',email,email);
              await rows(db,"DELETE FROM sessions WHERE email IN (SELECT email FROM users WHERE email=? AND active=0)",email);
            }
            await db.commit();
          } catch (error) {
            await db.rollback();
            throw error;
          }
          return redirect(res,'/usuarios');
        }
        const name = (data.get('name') || '').trim();
        const role = data.get('role');
        const ra = (data.get('ra') || '').trim().toUpperCase();
        if (!/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(ra) || ra.length > 32 || !validEmail || !name || name.length > 120 || !Object.hasOwn(roles,role)) {
          return page(res,'Revise os dados','<a href="/usuarios">Voltar</a>',400);
        }
        await db.beginTransaction();
        try {
          const result = await rows(db,'INSERT IGNORE INTO users(email,name,role,ra) VALUES (?,?,?,?)',email,name,role,ra);
          if (!result.affectedRows) {
            await db.rollback();
            return page(res,'E-mail ou RA já cadastrado','<a href="/usuarios">Voltar</a>',409);
          }
          const link = await issueFirstAccess(db,email,now);
          await db.commit();
          return await usersPage(db,res,link);
        } catch (error) {
          await db.rollback();
          throw error;
        }
      }
    }
    if (req.method === 'GET' && url.pathname === '/primeiro-acesso') {
      const code = url.searchParams.get('codigo') || '';
      const valid = /^[a-f0-9]{64}$/.test(code) && await one(db,`SELECT 1 FROM first_access f
        JOIN users u ON u.email=f.email WHERE f.token_hash=? AND f.expires>? AND u.active=1`,digest(code),now);
      return valid ? firstAccessPage(res,code) : page(res,'Link inválido ou expirado',
        '<p>Peça um novo link ao administrador.</p><a href="/">Voltar ao login</a>',400);
    }
    if (req.method === 'GET' && url.pathname === '/reservas') {
      if(!user)return json(res,401,{error:'Entre novamente.'});
      return json(res,200,await reservationList(db,user));
    }
    if (req.method === 'GET' && url.pathname === '/estoque') {
      if (!user) return json(res,401,{error:'Entre novamente.'});
      return json(res,200,await stockSnapshot(db,canManageStock(user)));
    }
    if (req.method === 'GET' && url.pathname === '/usuarios') {
      return user?.role === 'ti' ? await usersPage(db,res) : page(res,'Acesso restrito','<a href="/">Voltar</a>',403);
    }
    if (req.method === 'GET' && url.pathname === '/') {
      if (!user) return loginPage(res);
      const stock = await stockSnapshot(db,canManageStock(user));
      const reservations = await reservationList(db,user);
      const identity = JSON.stringify({role:user.role,name:user.name,email:user.email,stock,reservations}).replaceAll('<','\\u003c');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      return res.end(portal.replace('{{PORTAL_SESSION}}', () => identity));
    }
    return page(res,'Página não encontrada','<a href="/">Voltar</a>',404);
  } catch (error) {
    console.error('Falha na requisição do SysLab',error.code || error.name);
    return page(res,'Serviço indisponível','<a href="/">Tentar novamente</a>',500);
  } finally {
    db?.release();
  }
}).listen(Number(process.env.PORT || 3000));
