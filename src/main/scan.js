import { readdir } from 'node:fs/promises'
import { basename, dirname, sep } from 'node:path'

// scanned/{...}/{dep}/{code}_{hn}_{date_serv}_{vn}.zip
export async function scanDocs(root, typeNames = {}) {
  const files = await readdir(root, { recursive: true })
  return files
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .map((f) => {
      const [code, hn, date_serv, vn] = basename(f, '.zip').split('_')
      const dep = dirname(f).split(sep).pop()
      return {
        path: f.split(sep).join('/'),
        code,
        hn,
        date_serv,
        vn,
        dep,
        doc_type_name: typeNames[code?.toLowerCase()] || ''
      }
    })
    .sort((a, b) => b.date_serv?.localeCompare(a.date_serv) || 0)
}
