import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createSocket } from 'node:dgram'
import { join, normalize, extname, basename, dirname, sep } from 'node:path'
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

export function startServer(root, port, typeNames = {}) {
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
        if (url.pathname === '/view') {
          viewerPage(url.searchParams.get('src') || '', res)
          return
        }
        if (url.pathname === '/') {
          await searchPage(root, typeNames, url.searchParams.get('hn') || '', res)
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

async function searchPage(root, typeNames, hn, res) {
  let docs = []
  if (hn) {
    // layout is scanned/{hn}/{dep}/*.zip, so scan that one HN folder when it exists
    const sub = join(root, hn)
    const inSub = sub.startsWith(root + sep) && (await stat(sub).catch(() => null))?.isDirectory()
    docs = (await scanDocs(inSub ? sub : root, typeNames)).filter((d) => d.hn === hn)
    if (inSub) docs = docs.map((d) => ({ ...d, path: `${hn}/${d.path}` }))
  }
  // dep > วันที่ > รายการเอกสาร
  const tree = {}
  for (const d of docs) ((tree[d.dep] ||= {})[d.date_serv] ||= []).push(d)
  const thaiDate = (ymd) =>
    /^\d{8}$/.test(ymd)
      ? new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6))
          .toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })
          .replace(/ /g, '')
      : ymd
  const items = Object.entries(tree)
    .map(
      ([dep, byDate]) =>
        `<details open><summary class="dep">${esc(dep)} <em>${Object.values(byDate).flat().length}</em></summary>` +
        Object.entries(byDate)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(
            ([date, list]) =>
              `<details><summary class="date">${esc(thaiDate(date))} <em>${list.length}</em></summary>` +
              list
                .map(
                  (d) =>
                    `<a href="/view?src=/${encodeURIComponent(d.path).split('%2F').join('/')}" target="pdf" onclick="pick(this)">${FILE_ICON}${esc(d.doc_type_name || d.code)}</a>`
                )
                .join('') +
              `</details>`
          )
          .join('') +
        `</details>`
    )
    .join('')
  const body = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ระบบเอกสารผู้ป่วย Electronic</title>
<style>
  * { box-sizing: border-box; }
  :root { interpolate-size: allow-keywords; }
  /* smooth expand/collapse (Chromium 131+), older browsers just snap */
  details::details-content { block-size: 0; overflow: hidden; transition: block-size .22s ease, content-visibility .22s allow-discrete; }
  details[open]::details-content { block-size: auto; }
  body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; margin: 0; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 12px 16px; border-bottom: 1px solid #ddd; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 18px; margin: 0; }
  form { display: flex; gap: 8px; }
  input { padding: 8px; font-size: 15px; width: 160px; }
  button { padding: 8px 18px; font-size: 15px; cursor: pointer; }
  main { flex: 1; display: flex; min-height: 0; }
  nav { width: 300px; overflow: auto; border-right: 1px solid #ddd; }
  nav a { display: flex; align-items: center; gap: 8px; padding: 7px 14px 7px 32px; border-bottom: 1px solid #eee; text-decoration: none; color: #222; font-size: 14px; }
  nav a:hover { background: #eef3ff; }
  nav a.active { background: #2b5fd9; color: #fff; }
  summary { cursor: pointer; user-select: none; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '+'; display: inline-block; width: 14px; font-weight: 700; }
  details[open] > summary::before { content: '−'; }
  summary em { float: right; font-style: normal; opacity: .6; }
  summary.dep { padding: 8px 14px; background: #333; color: #fff; font-size: 13px; text-transform: uppercase; position: sticky; top: 0; z-index: 1; }
  summary.date { padding: 6px 14px 6px 20px; background: #f1f3f7; color: #445; font-size: 12px; }
  iframe { flex: 1; border: 0; }
  .empty { margin: auto; color: #888; }
  @media (max-width: 700px) { main { flex-direction: column; } nav { width: 100%; max-height: 40vh; } }
</style>
</head>
<body>
<header>
  <h1>ระบุ HN ที่ต้องการค้นเอกสาร</h1>
  <form method="get" action="/">
    <input name="hn" value="${esc(hn)}" placeholder="HN" autofocus>
    <button type="submit">ค้นหา</button>
  </form>
  ${hn ? `<span>HN ${esc(hn)} — ${docs.length} รายการ</span>` : ''}
</header>
<main>
  ${items ? `<nav>${items}</nav><iframe name="pdf" src="/view?src=/${encodeURIComponent(docs[0].path).split('%2F').join('/')}"></iframe>` : `<p class="empty">${hn ? `ไม่พบเอกสารของ HN ${esc(hn)}` : 'ระบุ HN ที่ต้องการค้นเอกสาร'}</p>`}
</main>
<script>
  function pick(a) {
    document.querySelectorAll('nav a').forEach((x) => x.classList.remove('active'))
    a.classList.add('active')
  }
  document.querySelector('nav a')?.classList.add('active')
</script>
</body>
</html>`
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

// pdf.js canvas viewer: drag to pan, ctrl+wheel or buttons to zoom
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
  #wrap.grabbing { cursor: grabbing; }
  canvas { display: block; margin: 0 auto 10px; box-shadow: 0 1px 6px rgba(0,0,0,.5); background: #fff; }
</style>
</head>
<body>
<div id="bar">
  <button id="out">&minus;</button><span id="pct">100%</span><button id="in">+</button>
  <button id="fit">พอดีความกว้าง</button>
  <span id="info"></span>
  <span style="margin-left:auto">ลากเพื่อเลื่อน</span>
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

async function render() {
  document.getElementById('pct').textContent = Math.round(scale * 100) + '%'
  wrap.textContent = ''
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const vp = page.getViewport({ scale: scale * dpr })
    const canvas = document.createElement('canvas')
    canvas.width = vp.width
    canvas.height = vp.height
    canvas.style.width = vp.width / dpr + 'px'
    canvas.style.height = vp.height / dpr + 'px'
    wrap.append(canvas)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
  }
}

// drag to pan
let drag = null
wrap.addEventListener('mousedown', (e) => {
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

doc = await pdfjs.getDocument({
  url: ${JSON.stringify(src)},
  wasmUrl: '/_pdf/wasm/',
  cMapUrl: '/_pdf/cmaps/',
  standardFontDataUrl: '/_pdf/standard_fonts/'
}).promise
document.getElementById('info').textContent = doc.numPages + ' หน้า'
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
