import { DatabaseSync } from 'node:sqlite'
import csv from '../../lookup/medico_scan_code.csv?raw'

// "code","doc_name","depart","no","dep_hos"
function parseCsv(text) {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) =>
      [...line.matchAll(/(?:^|,)(?:"([^"]*)"|([^,]*))/g)].map((m) => (m[1] ?? m[2] ?? '').trim())
    )
}

export function openDb(file) {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE IF NOT EXISTS c_doc_type (
    code TEXT PRIMARY KEY,
    dep TEXT NOT NULL,
    doc_type_name TEXT NOT NULL
  )`)
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const ins = db.prepare(`INSERT INTO c_doc_type (code, dep, doc_type_name) VALUES (?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET dep = excluded.dep, doc_type_name = excluded.doc_type_name`)
  for (const [code, doc_name, depart] of parseCsv(csv)) {
    if (code && doc_name) ins.run(code.toLowerCase(), depart, doc_name)
  }
  return db
}

export const getSetting = (db, key) =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || ''

export const setSetting = (db, key, value) =>
  db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
