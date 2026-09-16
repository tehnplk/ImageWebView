# ImageWebView — handoff

แอป Electron สำหรับเปิดดูเอกสารสแกนผู้ป่วย และเปิด HTTP server ให้เครื่องอื่นใน LAN ค้นด้วย HN แล้วดู PDF ได้

Stack: Electron 39 + React + Vite (electron-vite, JS ไม่ใช่ TS), sqlite = `node:sqlite` ที่มากับ Electron
Dependencies ที่เพิ่มเอง: `adm-zip` (ถอดรหัส zip), `pdfjs-dist` (viewer), `lucide-react` (ไอคอนในตัวแอป)

## โครงสร้างข้อมูล

```
scanned/{hn}/{dep}/{code}_{hn}_{date_serv}_{vn}.zip
```

- zip = ZipCrypto มี PDF ไฟล์เดียวข้างใน, password = `{hn}qazwsxedcr112233`
- `{code}` map เป็นชื่อเอกสารจากตาราง `c_doc_type` (seed จาก `lookup/medico_scan_code.csv`, 79 codes)
- ตอนนี้ข้อมูลจริงอยู่ที่ `E:\Electron\scanned`

## ไฟล์หลัก

| ไฟล์                       | หน้าที่                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/index.js`        | หน้าต่างแอป + IPC (`scanned-dir`, `pick-folder`, `scan-docs`, `start-server`, `stop-server`, `doc-types`)                                         |
| `src/main/db.js`           | เปิด sqlite ที่ `%APPDATA%/image-web-view/app.db`, สร้าง+seed `c_doc_type` จาก CSV, ตาราง `settings`                                              |
| `src/main/scan.js`         | เดินโฟลเดอร์ แยกชื่อไฟล์เป็น `{code,hn,date_serv,vn,dep}` + join ชื่อเอกสาร                                                                       |
| `src/main/server.js`       | HTTP server ทั้งหมด: `searchPage()` หน้าค้น HN + เมนูซ้าย, `viewerPage()` PDF viewer, `servePdf()` ถอดรหัส zip, route `/_pdf/*` เสิร์ฟ pdfjs-dist |
| `src/renderer/src/App.jsx` | หน้าแอป: เลือกโฟลเดอร์ / port / start-stop server / ตารางเอกสาร                                                                                   |
| `src/renderer/src/App.jsx` | หน้าแอป: เลือกโฟลเดอร์ / port / start-stop server                                                                                   |

## หน้าเว็บที่เสิร์ฟ (server-rendered ไม่มี framework)

- `/` `?hn=` → หน้าค้น: ซ้าย = เมนู `<details>` ซ้อนกัน dep (เปิดไว้) → วันที่ (ยุบไว้) → รายการเอกสาร, ขวา = `<iframe name="pdf">`
- `/view?src=/{path}.zip` → viewer: pdf.js render ลง canvas, ลากเมาส์ = pan, ctrl+wheel/ปุ่ม = zoom, เปิดมา fit width
- `/{path}.zip` → ถอดรหัสแล้วส่ง PDF ตรง ๆ (ไม่ผ่าน viewer)
- วันที่แสดง `17เม.ย.2569` ผ่าน `toLocaleDateString('th-TH')`, เรียงใหม่→เก่า
- +/− หน้าหัวกลุ่มมาจาก `summary::before`, animation จาก `::details-content` + `interpolate-size`

## รัน

```
npm run dev        # dev
npm run build:win  # แพ็ก
```

## กับดักที่เสียเวลาไปแล้ว

- **terminal ของ VSCode ตั้ง `ELECTRON_RUN_AS_NODE=1`** → `npm run dev` ตายที่ `electron.app is undefined` ให้รันจาก terminal ปกติ
- **pdf.js 6**: ต้องเรียก `getDocument({url})` (string ใช้ไม่ได้แล้ว), ต้อง polyfill `Map.getOrInsertComputed` (Chromium ยังไม่มี), และ PDF สแกนเป็น JBIG2 ต้องส่ง `wasmUrl` ไม่งั้นได้หน้าขาว — ทั้งหมดอยู่ใน `viewerPage()`
- **`?raw` ของ vite ใช้กับ dep ไม่ได้** ใน main process (externalizeDepsPlugin แปลงเป็น require) — pdfjs เลยเสิร์ฟจาก node_modules ผ่าน `/_pdf/*` ส่วน CSV inline ได้เพราะเป็นไฟล์ในโปรเจกต์
- **escape ใน template literal**: `'2'` ถูกอ่านเป็น octal escape ได้ตัวประหลาด — ใส่อักขระ `−` ตรง ๆ แทน
- **object key ที่เป็นตัวเลขล้วน** (เช่น `20250111`) วนลูปจากน้อยไปมากเสมอ ต้อง sort เองถ้าอยากได้ใหม่→เก่า
- server bind `0.0.0.0`, หา IP จาก interface ที่มี default route (UDP connect trick) — `os.networkInterfaces()` เลือก VPN/VirtualBox ผิด
- Windows Firewall จะถาม allow ครั้งแรก

## ยังไม่ได้ทำ

- ไม่มี login / auth — ใครใน LAN ก็เปิดดู PDF ได้
- ไม่มี UI จัดการ `c_doc_type` (แก้ CSV แล้ว build ใหม่)
- เมนูไม่จำสถานะย่อ/ขยาย และไม่มีปุ่มเลือกหน้า PDF (เลื่อนดูต่อเนื่องอย่างเดียว)
- ค้นได้เฉพาะ HN ตรงตัว ไม่มีค้นชื่อ/ช่วงวันที่, ไม่มี paging
- `lookup/` อีก 6 ไฟล์ยังไม่ได้ใช้
