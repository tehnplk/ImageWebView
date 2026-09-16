import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'

function App() {
  const [dir, setDir] = useState('')
  const [port, setPort] = useState(3000)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [docs, setDocs] = useState([])

  const load = async (path) => {
    setDir(path)
    setDocs(await window.api.scanDocs(path))
  }

  // start on the scanned folder if it's where it's expected to be
  useEffect(() => {
    window.api.scannedDir().then((d) => d && load(d))
    window.api.scannedDir().then((d) => d && setDir(d))
  }, [])

  const browse = async () => {
    const picked = await window.api.pickFolder()
    if (picked) await load(picked)
    if (picked) setDir(picked)
  }

  const toggle = async () => {
    setError('')
    try {
      if (url) {
        await window.api.stopServer()
        setUrl('')
      } else {
        setUrl(await window.api.startServer(dir, Number(port)))
      }
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  return (
    <div className="setup">
      <h2>Static HTML Server</h2>

      <label>Folder</label>
      <div className="row">
        <input value={dir} readOnly placeholder="เลือกโฟลเดอร์..." />
        <button onClick={browse} disabled={!!url}>
          Browse
        </button>
      </div>

      <label>Server port</label>
      <div className="row">
        <input
          type="number"
          value={port}
          min="1"
          max="65535"
          disabled={!!url}
          onChange={(e) => setPort(e.target.value)}
        />
      </div>

      <button className="primary" onClick={toggle} disabled={!dir}>
        {url ? 'Stop server' : 'Start server'}
      </button>

      {url && (
        <p className="ok">
          Serving <b>{dir}</b> — เครื่องอื่นเปิดที่{' '}
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </p>
      )}
      {error && <p className="err">{error}</p>}

      {docs.length > 0 && (
        <table className="docs">
          <thead>
            <tr>
              <th>Doc type</th>
              <th>dep</th>
              <th>HN</th>
              <th>Date</th>
              <th>VN</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.path}>
                <td>
                  <FileText size={14} className="ficon" />
                  {url ? (
                    <a href={`${url}/view?src=/${d.path}`} target="_blank" rel="noreferrer">
                      {d.doc_type_name || d.code}
                    </a>
                  ) : (
                    d.doc_type_name || d.code
                  )}
                </td>
                <td>{d.dep}</td>
                <td>{d.hn}</td>
                <td>{d.date_serv}</td>
                <td>{d.vn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default App
