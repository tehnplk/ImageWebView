import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createSocket } from 'node:dgram'
import { join, normalize, extname, basename, dirname, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { scanDocs } from './scan.js'
import { createRequire } from 'node:module'

// pdfjs-dist served straight out of node_modules (works inside app.asar too)
const pdfjsDir = () => dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'font/x-pfb'
}

let server = null
const sessions = new Map()

function parseCookies(req) {
  const list = {}
  const rc = req.headers.cookie
  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=')
      list[parts.shift().trim()] = decodeURI(parts.join('='))
    })
  }
  return list
}

function getSession(req) {
  const cookies = parseCookies(req)
  const sid = cookies.session_id
  if (sid && sessions.has(sid)) {
    return sessions.get(sid)
  }
  return null
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1e6) {
        req.destroy()
        reject(new Error('Body too large'))
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

// IP of the interface that holds the default route (os.networkInterfaces can't tell VPN/virtual apart)
export function lanIP() {
  return new Promise((resolve) => {
    const sock = createSocket('udp4')
    sock.on('error', () => resolve('localhost'))
    sock.connect(53, '8.8.8.8', () => {
      const { address } = sock.address()
      sock.close()
      resolve(address)
    })
  })
}

function loginPage(res, errorMsg = '', returnUrl = '/', username = '') {
  const body = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>เข้าสู่ระบบ - ระบบเอกสารผู้ป่วยอิเล็กทรอนิกส์</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: system-ui, "Segoe UI", Tahoma, sans-serif;
    background: #f1f5f9;
    color: #1e293b;
    padding: 20px;
  }
  .card {
    background: #fff;
    width: 100%;
    max-width: 400px;
    border-radius: 12px;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,.08), 0 8px 10px -6px rgba(0,0,0,.04);
    border: 1px solid #e2e8f0;
    padding: 36px 30px;
    text-align: center;
  }
  .icon-wrap {
    width: 60px;
    height: 60px;
    margin: 0 auto 16px;
    background: #eef3ff;
    color: #2b5fd9;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  h1 {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 6px;
    color: #0f172a;
  }
  .subtitle {
    font-size: 13px;
    color: #64748b;
    margin: 0 0 20px;
  }
  .badge-hosxp {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 22px;
  }
  form {
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  label {
    font-size: 13px;
    font-weight: 600;
    color: #334155;
  }
  input[type="text"], input[type="password"] {
    padding: 10px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 15px;
    outline: none;
    font-family: inherit;
    transition: border-color .15s, box-shadow .15s;
  }
  input[type="text"]:focus, input[type="password"]:focus {
    border-color: #2b5fd9;
    box-shadow: 0 0 0 3px rgba(43,95,217,.15);
  }
  .alert-error {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    text-align: left;
  }
  .btn-submit {
    margin-top: 6px;
    padding: 12px;
    background: #2b5fd9;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background .15s;
  }
  .btn-submit:hover {
    background: #1f4bbd;
  }
  .footer-note {
    margin-top: 24px;
    font-size: 12px;
    color: #94a3b8;
  }
</style>
</head>
<body>
<div class="card">
  <div class="icon-wrap">
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
      <path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
    </svg>
  </div>
  <h1>ระบบเอกสารผู้ป่วยอิเล็กทรอนิกส์</h1>
  <p class="subtitle">โรงพยาบาลโกสัมพีนคร</p>

  <div class="badge-hosxp">
    <span>🔒</span> เข้าสู่ระบบด้วยบัญชี HOSxP
  </div>

  ${errorMsg ? `<div class="alert-error"><span>⚠️</span><span>${esc(errorMsg)}</span></div>` : ''}

  <form method="post" action="/login">
    <input type="hidden" name="returnUrl" value="${esc(returnUrl)}">
    <div class="field">
      <label for="username">ชื่อผู้ใช้</label>
      <input id="username" name="username" type="text" value="${esc(username)}" required autofocus placeholder="ระบุชื่อผู้ใช้ HOSxP...">
    </div>
    <div class="field">
      <label for="password">รหัสผ่าน</label>
      <input id="password" name="password" type="password" required placeholder="ระบุรหัสผ่าน...">
    </div>
    <button type="submit" class="btn-submit">เข้าสู่ระบบด้วยบัญชี HOSxP</button>
  </form>

  <div class="footer-note">
    ตรวจสอบสิทธิ์ผ่านระบบ HOSxP
  </div>
</div>
</body>
</html>`
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

export function startServer(root, port, typeNames = {}, authUrl = 'http://127.0.0.1:8081') {
  root = normalize(root)
  return new Promise((resolve, reject) => {
    if (server) return reject(new Error('Server is already running'))
    const srv = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://x')
        if (url.pathname.startsWith('/_pdf/')) {
          const base = pdfjsDir()
          const lib = join(base, normalize(url.pathname.slice('/_pdf/'.length)))
          if (!lib.startsWith(base + sep)) {
            res.writeHead(403).end('Forbidden')
            return
          }
          res.writeHead(200, {
            'Content-Type': TYPES[extname(lib).toLowerCase()] || 'application/octet-stream',
            'Content-Length': (await stat(lib)).size,
            'Cache-Control': 'max-age=86400'
          })
          createReadStream(lib).pipe(res)
          return
        }

        if (url.pathname === '/login') {
          if (req.method === 'POST') {
            try {
              const params = new URLSearchParams(await readBody(req))
              const username = params.get('username')?.trim() || ''
              const password = params.get('password') || ''
              const returnUrl = params.get('returnUrl') || '/'
              const base = authUrl.replace(/\/+$/, '')
              const target = base.endsWith('/checkuser') ? base : base + '/checkuser'
              const authRes = await fetch(target, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ username, password }).toString(),
                signal: AbortSignal.timeout(5000)
              })
              const rawText = await authRes.text()
              const stripHtml = (str) =>
                (str || '')
                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()

              if (!authRes.ok) {
                const clean = stripHtml(rawText)
                let detail = clean
                if (/Lost connection to MySQL/i.test(clean)) {
                  detail = 'ฐานข้อมูล HOSxP ไม่ตอบสนอง (Lost connection to MySQL)'
                }
                loginPage(res, `ระบบตรวจสอบสิทธิ์ขัดข้อง (HTTP ${authRes.status}): ${detail.slice(0, 100)}`, returnUrl, username)
                return
              }

              let data = null
              try {
                data = JSON.parse(rawText)
              } catch (parseErr) {
                loginPage(res, `ระบบตรวจสอบสิทธิ์ส่งข้อมูลไม่ถูกต้อง: ${stripHtml(rawText).slice(0, 100)}`, returnUrl, username)
                return
              }
              if (Array.isArray(data) && data[0]?.status === 'true') {
                const sid = randomUUID()
                sessions.set(sid, {
                  username: data[0].username || username,
                  loginAt: Date.now()
                })
                res.writeHead(302, {
                  'Set-Cookie': `session_id=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
                  'Location': returnUrl.startsWith('/') ? returnUrl : '/'
                }).end()
                return
              } else {
                loginPage(res, 'ชื่อผู้ใช้หรือรหัสผ่าน HOSxP ไม่ถูกต้อง', returnUrl, username)
                return
              }
            } catch (err) {
              loginPage(res, `ไม่สามารถเชื่อมต่อไปยังระบบตรวจสอบสิทธิ์ (${err.message || err})`, returnUrl, username)
              return
            }
          }
          const session = getSession(req)
          if (session) {
            res.writeHead(302, { 'Location': '/' }).end()
            return
          }
          loginPage(res, '', url.searchParams.get('returnUrl') || '/', '')
          return
        }

        if (url.pathname === '/logout') {
          const cookies = parseCookies(req)
          if (cookies.session_id) sessions.delete(cookies.session_id)
          res.writeHead(302, {
            'Set-Cookie': 'session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
            'Location': '/login'
          }).end()
          return
        }

        // Require authentication for all application routes
        const session = getSession(req)
        if (!session) {
          const returnUrl = req.url || '/'
          res.writeHead(302, { 'Location': `/login?returnUrl=${encodeURIComponent(returnUrl)}` }).end()
          return
        }

        if (url.pathname === '/view') {
          viewerPage(url.searchParams.get('src') || '', res)
          return
        }
        if (url.pathname === '/') {
          await searchPage(root, typeNames, url.searchParams.get('hn') || '', res, session.username)
          return
        }
        const rel = normalize(decodeURIComponent(url.pathname))
        let file = join(root, rel)
        // trust boundary: never serve outside root
        if (file !== root && !file.startsWith(root + sep)) {
          res.writeHead(403).end('Forbidden')
          return
        }
        if (extname(file).toLowerCase() === '.zip') {
          servePdf(file, res)
          return
        }
        let info = await stat(file)
        if (info.isDirectory()) {
          file = join(file, 'index.html')
          info = await stat(file)
        }
        res.writeHead(200, {
          'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
          'Content-Length': info.size
        })
        createReadStream(file).pipe(res)
      } catch {
        res.writeHead(404).end('Not Found')
      }
    })
    srv.on('error', (err) => {
      server = null
      reject(err)
    })
    // 0.0.0.0: reachable from other machines on the LAN
    srv.listen(port, '0.0.0.0', async () => {
      server = srv
      resolve(`http://${await lanIP()}:${port}`)
    })
  })
}

const FILE_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>' +
  '<path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>'

const esc = (s) =>
  String(s ?? '')
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;')

async function searchPage(root, typeNames, hn, res, currentUsername = '') {
  let docs = []
  if (hn) {
    // layout is scanned/{hn}/{dep}/*.zip, so scan that one HN folder when it exists
    const sub = join(root, hn)
    const inSub = sub.startsWith(root + sep) && (await stat(sub).catch(() => null))?.isDirectory()
    docs = (await scanDocs(inSub ? sub : root, typeNames)).filter((d) => d.hn === hn)
    if (inSub) docs = docs.map((d) => ({ ...d, path: `${hn}/${d.path}` }))
  }

  // 1. treeByDate: dep > วันที่ > รายการเอกสาร
  const treeByDate = {}
  for (const d of docs) ((treeByDate[d.dep] ||= {})[d.date_serv] ||= []).push(d)

  // 2. treeByType: dep > ประเภทเอกสาร > วันที่
  const treeByType = {}
  for (const d of docs) {
    const typeKey = d.doc_type_name || d.code || 'ไม่ระบุประเภท'
    ;((treeByType[d.dep] ||= {})[typeKey] ||= []).push(d)
  }

  const thaiDate = (ymd) =>
    /^\d{8}$/.test(ymd)
      ? new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6))
          .toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })
          .replace(/ /g, '')
      : ymd
  const depOrder = (d) => {
    const s = String(d || '').toLowerCase()
    if (s === 'opd') return 1
    if (s === 'ipd') return 2
    return 3
  }
  let firstDoc = null

  const itemsByDate = Object.entries(treeByDate)
    .sort(([a], [b]) => depOrder(a) - depOrder(b) || a.localeCompare(b))
    .map(
      ([dep, byDate]) =>
        `<details open><summary class="dep">${esc(dep)} <em>${Object.values(byDate).flat().length}</em></summary>` +
        Object.entries(byDate)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, list]) => {
            if (!firstDoc && list.length) firstDoc = list[0]
            return (
              `<details><summary class="date">${esc(thaiDate(date))} <em>${list.length}</em></summary>` +
              list
                .map(
                  (d) =>
                    `<a href="/view?src=/${encodeURIComponent(d.path).split('%2F').join('/')}" target="pdf" onclick="pick(this)">${FILE_ICON}${esc(d.doc_type_name || d.code)}</a>`
                )
                .join('') +
              `</details>`
            )
          })
          .join('') +
        `</details>`
    )
    .join('')

  const itemsByType = Object.entries(treeByType)
    .sort(([a], [b]) => depOrder(a) - depOrder(b) || a.localeCompare(b))
    .map(
      ([dep, byType]) =>
        `<details open><summary class="dep">${esc(dep)} <em>${Object.values(byType).flat().length}</em></summary>` +
        Object.entries(byType)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([typeName, list]) => {
            list.sort((a, b) => (b.date_serv || '').localeCompare(a.date_serv || ''))
            return (
              `<details><summary class="date doc-type">${esc(typeName)} <em>${list.length}</em></summary>` +
              list
                .map(
                  (d) =>
                    `<a href="/view?src=/${encodeURIComponent(d.path).split('%2F').join('/')}" target="pdf" onclick="pick(this)">${FILE_ICON}${esc(thaiDate(d.date_serv))}</a>`
                )
                .join('') +
              `</details>`
            )
          })
          .join('') +
        `</details>`
    )
    .join('')

  const body = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ระบบเอกสารผู้ป่วยอิเล็กทรอนิกส์</title>
<style>
  * { box-sizing: border-box; }
  :root { interpolate-size: allow-keywords; }
  /* smooth expand/collapse (Chromium 131+), older browsers just snap */
  details::details-content { block-size: 0; overflow: hidden; transition: block-size .22s ease, content-visibility .22s allow-discrete; }
  details[open]::details-content { block-size: auto; }
  body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; margin: 0; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 10px 16px; border-bottom: 1px solid #ddd; display: flex; align-items: center; justify-content: center; position: relative; min-height: 52px; background: #fff; }
  .header-left { position: absolute; left: 16px; display: flex; align-items: center; gap: 8px; }
  .header-right { position: absolute; right: 16px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .user-badge { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; color: #334155; font-weight: 500; font-size: 12px; }
  .user-badge svg { color: #2b5fd9; }
  .btn-logout { display: inline-flex; align-items: center; text-decoration: none; padding: 5px 9px; background: #fff1f2; color: #e11d48; border: 1px solid #fecdd3; border-radius: 4px; font-weight: 500; font-size: 12px; transition: background .15s; }
  .btn-logout:hover { background: #ffe4e6; }
  .search-box { display: flex; align-items: center; gap: 8px; font-size: 15px; }
  .search-box label { font-weight: 700; color: #222; }
  .search-box input { padding: 7px 12px; font-size: 15px; width: 170px; border: 1px solid #bbb; border-radius: 4px; outline: none; }
  .search-box input:focus { border-color: #2b5fd9; box-shadow: 0 0 0 2px rgba(43,95,217,.2); }
  .search-box button { padding: 7px 18px; font-size: 15px; cursor: pointer; background: #2b5fd9; color: #fff; border: 1px solid #2b5fd9; border-radius: 4px; font-weight: 500; }
  .search-box button:hover { background: #1f4bbd; }
  main { flex: 1; display: flex; min-height: 0; }
  #toggle-nav { display: flex; align-items: center; justify-content: center; padding: 6px 8px; background: #fff; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; color: #444; }
  #toggle-nav:hover { background: #f0f2f5; }
  #toggle-view { display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #fff; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; color: #333; font-size: 13px; font-family: inherit; font-weight: 500; transition: background .15s, border-color .15s; }
  #toggle-view:hover { background: #f0f2f5; border-color: #bbb; }
  #toggle-view svg { color: #555; }
  .badge-mode { font-size: 11px; background: #eef3ff; color: #2b5fd9; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
  nav { width: 300px; overflow: auto; border-right: 1px solid #ddd; transition: width .2s ease, min-width .2s ease; flex-shrink: 0; }
  nav.collapsed { width: 0 !important; min-width: 0 !important; border-right: none !important; overflow: hidden !important; visibility: hidden; }
  nav a { display: flex; align-items: center; gap: 8px; padding: 7px 14px 7px 32px; border-bottom: 1px solid #eee; text-decoration: none; color: #222; font-size: 12px; }
  nav a:hover { background: #eef3ff; }
  nav a.active { background: #2b5fd9; color: #fff; }
  summary { cursor: pointer; user-select: none; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '+'; display: inline-block; width: 14px; font-weight: 700; }
  details[open] > summary::before { content: '−'; }
  summary em { float: right; font-style: normal; opacity: .6; }
  summary.dep { padding: 8px 14px; background: #e5e9f0; color: #1e293b; font-size: 13px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; position: sticky; top: 0; z-index: 1; }
  summary.date { padding: 6px 14px 6px 20px; background: #f1f3f7; color: #445; font-size: 14px; font-weight: 600; }
  iframe { flex: 1; border: 0; }
  .empty { margin: auto; color: #888; }
  @media (max-width: 700px) {
    header { flex-direction: column; gap: 8px; padding: 10px; }
    .header-left { position: static; }
    .header-right { position: static; }
    main { flex-direction: column; }
    nav { width: 100%; max-height: 40vh; }
    nav.collapsed { max-height: 0 !important; width: 100% !important; border-bottom: none !important; }
  }
</style>
</head>
<body>
<header>
  <div class="header-left">
    ${itemsByDate ? `<button id="toggle-nav" type="button" onclick="toggleNav()" title="ย่อ/ขยายเมนูด้านซ้าย (Ctrl+B)">
      <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="3" x2="9" y2="21"></line>
      </svg>
    </button>
    <button id="toggle-view" type="button" onclick="toggleView()" title="สลับมุมมอง (วันที่ / ประเภทเอกสาร)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
      </svg>
      <span>สลับมุมมอง</span>
      <span id="view-mode-badge" class="badge-mode">ตามวันที่</span>
    </button>` : ''}
  </div>
  <form method="get" action="/" class="search-box">
    <label for="hn-input">HN</label>
    <input id="hn-input" name="hn" value="${esc(hn)}" placeholder="ระบุ HN..." autofocus onfocus="this.select()">
    <button type="submit">ค้นหา</button>
  </form>
  ${currentUsername ? `<div class="header-right">
    <span class="user-badge" title="ผู้ใช้งานปัจจุบัน">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
      <span>${esc(currentUsername)}</span>
    </span>
    <a href="/logout" class="btn-logout" title="ออกจากระบบ">ออกจากระบบ</a>
  </div>` : ''}
</header>
<main>
  ${itemsByDate && firstDoc ? `<nav id="nav">
    <div id="view-by-date">${itemsByDate}</div>
    <div id="view-by-type" style="display:none;">${itemsByType}</div>
  </nav><iframe name="pdf" src="/view?src=/${encodeURIComponent(firstDoc.path).split('%2F').join('/')}"></iframe>` : `<p class="empty">${hn ? `ไม่พบเอกสารของ HN ${esc(hn)}` : 'ระบุ HN ที่ต้องการค้นเอกสาร'}</p>`}
</main>
<script>
  const hnInput = document.getElementById('hn-input')
  if (hnInput) {
    let justFocused = false
    hnInput.addEventListener('focus', () => {
      justFocused = true
      hnInput.select()
    })
    hnInput.addEventListener('mouseup', (e) => {
      if (justFocused) {
        e.preventDefault()
        justFocused = false
      }
    })
    hnInput.addEventListener('blur', () => {
      justFocused = false
    })
    setTimeout(() => hnInput.select(), 50)
  }

  function pick(a) {
    document.querySelectorAll('nav a').forEach((x) => x.classList.remove('active'))
    a.classList.add('active')
    const href = a.getAttribute('href')
    document.querySelectorAll('nav a[href="' + href + '"]').forEach((x) => {
      x.classList.add('active')
      x.closest('details')?.setAttribute('open', '')
    })
  }
  document.querySelector('nav a')?.classList.add('active')

  let currentViewMode = localStorage.getItem('nav_view_mode') || 'date'

  function syncActiveLink() {
    const active = document.querySelector('nav a.active')
    let href = active ? active.getAttribute('href') : null
    if (!href) {
      const iframe = document.querySelector('iframe[name="pdf"]')
      if (iframe && iframe.src) {
        try {
          const u = new URL(iframe.src, location.origin)
          href = '/view?src=' + (u.searchParams.get('src') || '')
        } catch (e) {}
      }
    }
    if (href) {
      document.querySelectorAll('nav a[href="' + href + '"]').forEach((x) => {
        x.classList.add('active')
        x.closest('details')?.setAttribute('open', '')
      })
    } else {
      const container = currentViewMode === 'type' ? document.getElementById('view-by-type') : document.getElementById('view-by-date')
      const first = container?.querySelector('a')
      if (first) {
        first.classList.add('active')
        first.closest('details')?.setAttribute('open', '')
      }
    }
  }

  function setViewMode(mode) {
    currentViewMode = mode
    localStorage.setItem('nav_view_mode', mode)
    const byDateEl = document.getElementById('view-by-date')
    const byTypeEl = document.getElementById('view-by-type')
    const badge = document.getElementById('view-mode-badge')
    if (badge) {
      badge.textContent = mode === 'type' ? 'ตามประเภทเอกสาร' : 'ตามวันที่'
    }
    if (byDateEl && byTypeEl) {
      if (mode === 'type') {
        byDateEl.style.display = 'none'
        byTypeEl.style.display = 'block'
      } else {
        byDateEl.style.display = 'block'
        byTypeEl.style.display = 'none'
      }
    }
    syncActiveLink()
  }

  function toggleView() {
    setViewMode(currentViewMode === 'date' ? 'type' : 'date')
  }

  if (currentViewMode === 'type') {
    setViewMode('type')
  } else {
    syncActiveLink()
  }

  function toggleNav() {
    const nav = document.getElementById('nav')
    if (!nav) return
    const isCollapsed = nav.classList.toggle('collapsed')
    localStorage.setItem('nav_collapsed', isCollapsed ? '1' : '0')
  }
  if (localStorage.getItem('nav_collapsed') === '1') {
    document.getElementById('nav')?.classList.add('collapsed')
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      toggleNav()
    }
  })
</script>
</body>
</html>`
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

// pdf.js canvas viewer: drag to pan, ctrl+wheel or buttons to zoom
// pdf.js canvas viewer with Annotation Tools (Pen, Highlighter, Text, Undo, Clear, LocalStorage)
function viewerPage(src, res) {
  const body = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>PDF</title>
<style>
  body { margin: 0; font-family: system-ui, Tahoma, sans-serif; display: flex; flex-direction: column; height: 100vh; background: #525659; }
  #bar { display: flex; gap: 6px; align-items: center; padding: 6px 10px; background: #333; color: #eee; font-size: 13px; }
  #bar button { padding: 3px 10px; cursor: pointer; }
  #wrap { flex: 1; overflow: auto; cursor: grab; padding: 10px 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, Tahoma, sans-serif; display: flex; flex-direction: column; height: 100vh; background: #525659; user-select: none; }
  #bar { display: flex; gap: 6px; align-items: center; padding: 6px 12px; background: #22262a; color: #eee; font-size: 13px; border-bottom: 1px solid #111; flex-wrap: wrap; z-index: 10; }
  #bar button { padding: 4px 10px; cursor: pointer; background: #373b40; border: 1px solid #555a60; color: #fff; border-radius: 4px; font-size: 13px; display: inline-flex; align-items: center; gap: 4px; transition: background .15s; }
  #bar button:hover { background: #4a4f55; }
  #bar button.active { background: #2b5fd9; border-color: #2b5fd9; font-weight: 600; }
  .sep { width: 1px; height: 20px; background: #444950; margin: 0 4px; }
  .color-btn { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0 !important; }
  .color-btn.active { border-color: #fff !important; box-shadow: 0 0 0 1px #000; }
  #stroke-size { background: #373b40; color: #fff; border: 1px solid #555a60; border-radius: 4px; padding: 3px 6px; font-size: 12px; outline: none; }
  #wrap { flex: 1; overflow: auto; cursor: grab; padding: 12px 0; }
  #wrap.grabbing { cursor: grabbing; }
  #wrap.drawing { cursor: crosshair; }
  .page-box { position: relative; margin: 0 auto 12px; box-shadow: 0 2px 8px rgba(0,0,0,.5); background: #fff; }
  .page-box canvas.pdf-canvas { display: block; width: 100%; height: 100%; }
  .page-box canvas.annot-canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; touch-action: none; }
</style>
</head>
<body>
<div id="bar">
  <button id="out" title="ย่อ">&minus;</button>
  <span id="pct" style="min-width:40px; text-align:center;">100%</span>
  <button id="in" title="ขยาย">+</button>
  <button id="fit">พอดีกับความกว้าง</button>
  <span id="info" style="color:#ddd; font-size:12px; margin: 0 6px;"></span>

  <div class="sep"></div>

  <button id="tool-pan" class="active" title="โหมดเลื่อนหน้า">🖐️ เลื่อน</button>
  <button id="tool-pen" title="โหมดปากกา">✏️ ปากกา</button>
  <button id="tool-highlighter" title="โหมดไฮไลต์เน้นข้อความ">🖍️ ไฮไลต์</button>
  <button id="tool-text" title="โหมดใส่ข้อความ">🔤 ข้อความ</button>

  <div class="sep"></div>

  <div id="color-group" style="display:flex; align-items:center; gap:4px;">
    <button class="color-btn active" data-color="#e11d48" style="background:#e11d48;" title="สีแดง"></button>
    <button class="color-btn" data-color="#2563eb" style="background:#2563eb;" title="สีน้ำเงิน"></button>
    <button class="color-btn" data-color="#16a34a" style="background:#16a34a;" title="สีเขียว"></button>
    <button class="color-btn" data-color="#eab308" style="background:#eab308;" title="สีเหลือง"></button>
    <button class="color-btn" data-color="#18181b" style="background:#18181b;" title="สีดำ"></button>
  </div>

  <select id="stroke-size" title="ขนาดเส้น">
    <option value="2">2px</option>
    <option value="4" selected>4px</option>
    <option value="8">8px</option>
  </select>

  <div class="sep"></div>

  <button id="btn-undo" title="เลิกทำ (Ctrl+Z)">↩️ เลิกทำ</button>
  <button id="btn-clear" title="ล้างเครื่องหมายทั้งหมด">🗑️ ล้างทั้งหมด</button>
</div>
<div id="wrap"></div>
<script>
// pdf.js 6 uses the Map upsert proposal; Electron/older Chrome don't have it yet
for (const C of [Map, WeakMap]) {
  if (!C.prototype.getOrInsertComputed) {
    C.prototype.getOrInsertComputed = function (key, fn) {
      if (!this.has(key)) this.set(key, fn(key))
      return this.get(key)
    }
  }
  if (!C.prototype.getOrInsert) {
    C.prototype.getOrInsert = function (key, value) {
      if (!this.has(key)) this.set(key, value)
      return this.get(key)
    }
  }
}
</script>
<script type="module">
import * as pdfjs from '/_pdf/legacy/build/pdf.min.mjs'
pdfjs.GlobalWorkerOptions.workerSrc = '/_pdf/legacy/build/pdf.worker.min.mjs'

const wrap = document.getElementById('wrap')
const dpr = window.devicePixelRatio || 1
let doc, scale = 1

const STORAGE_KEY = 'pdf_annot_' + encodeURIComponent(${JSON.stringify(src)})
let annotations = {}
try {
  annotations = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
} catch {}

let undoStack = []
let currentMode = 'pan' // 'pan' | 'pen' | 'highlighter' | 'text'
let currentColor = '#e11d48'
let currentSize = 4

function saveAnnotations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations))
}

function drawPageAnnotations(pageNum, canvas) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const items = annotations[pageNum] || []
  const w = canvas.width
  const h = canvas.height
  const scaleFactor = w / 1000

  for (const item of items) {
    if (item.type === 'path') {
      if (!item.points || item.points.length === 0) continue
      ctx.save()
      ctx.beginPath()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (item.tool === 'highlighter') {
        ctx.strokeStyle = item.color || '#eab308'
        ctx.lineWidth = Math.max(12 * scaleFactor, (item.size || 8) * scaleFactor * 3.5)
        ctx.globalAlpha = 0.35
      } else {
        ctx.strokeStyle = item.color || '#e11d48'
        ctx.lineWidth = Math.max(1.5, (item.size || 4) * scaleFactor)
        ctx.globalAlpha = 1.0
      }
      const p0 = item.points[0]
      ctx.moveTo(p0.x * w, p0.y * h)
      for (let i = 1; i < item.points.length; i++) {
        ctx.lineTo(item.points[i].x * w, item.points[i].y * h)
      }
      ctx.stroke()
      ctx.restore()
    } else if (item.type === 'text') {
      ctx.save()
      const fontSize = Math.max(14, (item.size || 16) * scaleFactor * 1.5)
      ctx.font = 'bold ' + fontSize + 'px system-ui, Tahoma, sans-serif'
      ctx.fillStyle = item.color || '#e11d48'
      ctx.fillText(item.text, item.x * w, item.y * h)
      ctx.restore()
    }
  }
}

function setupAnnotEvents(annotCanvas) {
  const pageNum = annotCanvas.dataset.page
  let activeStroke = null

  annotCanvas.addEventListener('pointerdown', (e) => {
    if (currentMode !== 'pen' && currentMode !== 'highlighter') return
    annotCanvas.setPointerCapture(e.pointerId)
    const rect = annotCanvas.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    activeStroke = {
      type: 'path',
      tool: currentMode,
      color: currentColor,
      size: currentSize,
      points: [{ x: nx, y: ny }]
    }
  })

  annotCanvas.addEventListener('pointermove', (e) => {
    if (!activeStroke) return
    const rect = annotCanvas.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    const prev = activeStroke.points[activeStroke.points.length - 1]
    activeStroke.points.push({ x: nx, y: ny })

    const ctx = annotCanvas.getContext('2d')
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const scaleFactor = annotCanvas.width / 1000
    if (activeStroke.tool === 'highlighter') {
      ctx.strokeStyle = activeStroke.color
      ctx.lineWidth = Math.max(12 * scaleFactor, activeStroke.size * scaleFactor * 3.5)
      ctx.globalAlpha = 0.35
    } else {
      ctx.strokeStyle = activeStroke.color
      ctx.lineWidth = Math.max(1.5, activeStroke.size * scaleFactor)
      ctx.globalAlpha = 1.0
    }
    ctx.beginPath()
    ctx.moveTo(prev.x * annotCanvas.width, prev.y * annotCanvas.height)
    ctx.lineTo(nx * annotCanvas.width, ny * annotCanvas.height)
    ctx.stroke()
    ctx.restore()
  })

  const endStroke = () => {
    if (!activeStroke) return
    annotations[pageNum] = annotations[pageNum] || []
    annotations[pageNum].push(activeStroke)
    undoStack.push({ pageNum, item: activeStroke })
    activeStroke = null
    saveAnnotations()
    drawPageAnnotations(pageNum, annotCanvas)
  }

  annotCanvas.addEventListener('pointerup', endStroke)
  annotCanvas.addEventListener('pointercancel', endStroke)

  annotCanvas.addEventListener('click', (e) => {
    if (currentMode !== 'text') return
    const rect = annotCanvas.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height
    const text = prompt('พิมพ์ข้อความกำกับ:')
    if (text && text.trim()) {
      const textItem = {
        type: 'text',
        text: text.trim(),
        color: currentColor,
        size: currentSize * 3 + 10,
        x: nx,
        y: ny
      }
      annotations[pageNum] = annotations[pageNum] || []
      annotations[pageNum].push(textItem)
      undoStack.push({ pageNum, item: textItem })
      saveAnnotations()
      drawPageAnnotations(pageNum, annotCanvas)
    }
  })
}

let renderToken = 0

async function render() {
  const currentToken = ++renderToken
  document.getElementById('pct').textContent = Math.round(scale * 100) + '%'
  wrap.textContent = ''
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    if (currentToken !== renderToken) return
    const vp = page.getViewport({ scale: scale * dpr })
    const pageBox = document.createElement('div')
    pageBox.className = 'page-box'
    pageBox.style.width = (vp.width / dpr) + 'px'
    pageBox.style.height = (vp.height / dpr) + 'px'

    const pdfCanvas = document.createElement('canvas')
    pdfCanvas.className = 'pdf-canvas'
    pdfCanvas.width = vp.width
    pdfCanvas.height = vp.height
    pageBox.append(pdfCanvas)

    const annotCanvas = document.createElement('canvas')
    annotCanvas.className = 'annot-canvas'
    annotCanvas.dataset.page = n
    annotCanvas.width = vp.width
    annotCanvas.height = vp.height
    annotCanvas.style.pointerEvents = currentMode === 'pan' ? 'none' : 'auto'
    setupAnnotEvents(annotCanvas)
    pageBox.append(annotCanvas)

    wrap.append(pageBox)
    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise
    if (currentToken !== renderToken) return
    drawPageAnnotations(n, annotCanvas)
  }
}

// drag to pan
let drag = null
wrap.addEventListener('mousedown', (e) => {
  if (currentMode !== 'pan') return
  drag = { x: e.clientX, y: e.clientY, left: wrap.scrollLeft, top: wrap.scrollTop }
  wrap.classList.add('grabbing')
  e.preventDefault()
})
addEventListener('mousemove', (e) => {
  if (!drag) return
  wrap.scrollLeft = drag.left - (e.clientX - drag.x)
  wrap.scrollTop = drag.top - (e.clientY - drag.y)
})
addEventListener('mouseup', () => {
  drag = null
  wrap.classList.remove('grabbing')
})
wrap.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return
  e.preventDefault()
  scale = Math.min(6, Math.max(0.25, scale * (e.deltaY < 0 ? 1.1 : 0.9)))
  render()
}, { passive: false })
const zoom = (f) => { scale = Math.min(6, Math.max(0.25, scale * f)); render() }
const fitWidth = async () => {
  const vp = (await doc.getPage(1)).getViewport({ scale: 1 })
  scale = (wrap.clientWidth - 24) / vp.width
}
document.getElementById('in').onclick = () => zoom(1.25)
document.getElementById('out').onclick = () => zoom(0.8)
document.getElementById('fit').onclick = async () => {
  await fitWidth()
  render()
}

// Mode switching
function setMode(mode) {
  currentMode = mode
  document.querySelectorAll('#bar button[id^="tool-"]').forEach(b => b.classList.remove('active'))
  document.getElementById('tool-' + mode)?.classList.add('active')
  const isPan = mode === 'pan'
  wrap.classList.toggle('drawing', !isPan)
  document.querySelectorAll('.annot-canvas').forEach(c => {
    c.style.pointerEvents = isPan ? 'none' : 'auto'
  })
}
document.getElementById('tool-pan').onclick = () => setMode('pan')
document.getElementById('tool-pen').onclick = () => setMode('pen')
document.getElementById('tool-highlighter').onclick = () => setMode('highlighter')
document.getElementById('tool-text').onclick = () => setMode('text')

// Color picker
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    currentColor = btn.dataset.color
  }
})

// Stroke size
document.getElementById('stroke-size').onchange = (e) => {
  currentSize = Number(e.target.value) || 4
}

// Undo
function handleUndo() {
  if (!undoStack.length) return
  const last = undoStack.pop()
  if (annotations[last.pageNum]) {
    const idx = annotations[last.pageNum].indexOf(last.item)
    if (idx !== -1) {
      annotations[last.pageNum].splice(idx, 1)
    } else {
      annotations[last.pageNum].pop()
    }
    saveAnnotations()
    const c = document.querySelector('.annot-canvas[data-page="' + last.pageNum + '"]')
    if (c) drawPageAnnotations(last.pageNum, c)
  }
}
document.getElementById('btn-undo').onclick = handleUndo
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    handleUndo()
  }
})

// Clear all (inline 2-step confirmation without blocking modal)
let clearPending = false
const btnClear = document.getElementById('btn-clear')
btnClear.onclick = () => {
  if (!clearPending) {
    clearPending = true
    btnClear.textContent = '⚠️ ยืนยันล้าง'
    btnClear.style.background = '#e11d48'
    setTimeout(() => {
      clearPending = false
      btnClear.textContent = '🗑️ ล้างทั้งหมด'
      btnClear.style.background = ''
    }, 3500)
    return
  }
  clearPending = false
  btnClear.textContent = '🗑️ ล้างทั้งหมด'
  btnClear.style.background = ''
  annotations = {}
  undoStack = []
  saveAnnotations()
  document.querySelectorAll('.annot-canvas').forEach(c => drawPageAnnotations(c.dataset.page, c))
}

let currentPage = 1
function updatePageInfo() {
  const infoEl = document.getElementById('info')
  if (!infoEl || !doc) return
  infoEl.textContent = 'หน้า ' + currentPage + ' จาก ' + doc.numPages
}

wrap.addEventListener('scroll', () => {
  const boxes = document.querySelectorAll('.page-box')
  if (!boxes.length) return
  const wrapRect = wrap.getBoundingClientRect()
  const triggerY = wrapRect.top + wrapRect.height * 0.4
  let visiblePage = 1
  for (let i = 0; i < boxes.length; i++) {
    const r = boxes[i].getBoundingClientRect()
    if (r.top <= triggerY) visiblePage = i + 1
  }
  if (currentPage !== visiblePage) {
    currentPage = visiblePage
    updatePageInfo()
  }
}, { passive: true })

doc = await pdfjs.getDocument({
  url: ${JSON.stringify(src)},
  wasmUrl: '/_pdf/wasm/',
  cMapUrl: '/_pdf/cmaps/',
  standardFontDataUrl: '/_pdf/standard_fonts/'
}).promise
updatePageInfo()
await fitWidth()
render()
</script>
</body>
</html>`
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

// zip = {code}_{hn}_{date_serv}_{vn}.zip, ZipCrypto, one file inside, password from hn
function servePdf(file, res) {
  const hn = basename(file, extname(file)).split('_')[1]
  const zip = new AdmZip(file)
  const entry = zip.getEntries()[0]
  const buf = zip.readFile(entry, hn + 'qazwsxedcr112233')
  if (!buf) {
    res.writeHead(500).end('Cannot decrypt')
    return
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(entry.entryName).toLowerCase()] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Content-Disposition': `inline; filename="${encodeURIComponent(entry.name)}"`
  })
  res.end(buf)
}

export function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve()
    server.close(() => resolve())
    server.closeAllConnections?.()
    server = null
  })
}
