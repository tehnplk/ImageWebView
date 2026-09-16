import { useEffect, useState } from 'react'

function App() {
  const [dir, setDir] = useState('')
  const [port, setPort] = useState(3000)
  const [authUrl, setAuthUrl] = useState('http://127.0.0.1:8081')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [testingAuth, setTestingAuth] = useState(false)
  const [authStatus, setAuthStatus] = useState(null)

  // start on the scanned folder if it's where it's expected to be
  // Auto-updater states
  const [appVersion, setAppVersion] = useState('0.1.0')
  const [updateInfo, setUpdateInfo] = useState(null)
  const [downloadProgress, setDownloadProgress] = useState(null)
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [checkMsg, setCheckMsg] = useState('')

  useEffect(() => {
    window.api.scannedDir().then((d) => d && setDir(d))
    window.api.getAuthUrl().then((u) => u && setAuthUrl(u))
    window.api.getAppVersion?.().then((v) => v && setAppVersion(v))

    const cleanup = window.api.onUpdateStatus?.((status) => {
      if (status.state === 'available') {
        setUpdateInfo(status)
        setCheckMsg('')
      } else if (status.state === 'downloading') {
        setDownloadProgress(status.percent)
      } else if (status.state === 'downloaded') {
        setIsDownloaded(true)
        setDownloadProgress(null)
      } else if (status.state === 'not-available') {
        setCheckMsg('คุณกำลังใช้งานเวอร์ชันล่าสุดแล้ว (' + (status.version || appVersion) + ')')
        setTimeout(() => setCheckMsg(''), 4000)
      } else if (status.state === 'checking') {
        setCheckMsg('กำลังตรวจสอบเวอร์ชันใหม่...')
      } else if (status.state === 'error') {
        setCheckMsg('')
      }
    })

    return () => cleanup?.()
  }, [])

  const browse = async () => {
    const picked = await window.api.pickFolder()
    if (picked) setDir(picked)
  }

  const handleAuthChange = (val) => {
    setAuthUrl(val)
    setAuthStatus(null)
    window.api.setAuthUrl(val)
  }

  const testAuth = async () => {
    setTestingAuth(true)
    setAuthStatus(null)
    try {
      const res = await window.api.testAuthUrl(authUrl)
      setAuthStatus(res)
    } catch (e) {
      setAuthStatus({ ok: false, msg: String(e.message || e) })
    } finally {
      setTestingAuth(false)
    }
  }

  const toggle = async () => {
    setError('')
    try {
      if (url) {
        await window.api.stopServer()
        setUrl('')
      } else {
        setUrl(await window.api.startServer(dir, Number(port), authUrl))
      }
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  const handleStartUpdate = async () => {
    try {
      await window.api.downloadUpdate?.()
    } catch (e) {
      setError('เกิดข้อผิดพลาดในการดาวน์โหลด: ' + (e.message || e))
    }
  }

  const handleInstallNow = () => {
    window.api.installUpdate?.()
  }

  const handleManualCheck = async (e) => {
    e?.preventDefault()
    setCheckMsg('กำลังตรวจสอบ...')
    await window.api.checkForUpdates?.()
  }

  return (
    <div className="setup">
      <h2>ImageWebView Server</h2>

      {/* Auto Update Notification Banner */}
      {updateInfo && (
        <div className="update-card">
          <div className="update-card-header">
            <div className="update-title">
              <span>🚀</span>
              <div>
                <strong>พบเวอร์ชันใหม่ v{updateInfo.version}</strong>
              </div>
            </div>
            {isDownloaded ? (
              <button className="btn-update install" onClick={handleInstallNow}>
                รีสตาร์ทเพื่อติดตั้ง
              </button>
            ) : downloadProgress !== null ? (
              <span style={{ fontSize: '13px', color: '#93c5fd' }}>{downloadProgress}%</span>
            ) : (
              <button className="btn-update" onClick={handleStartUpdate}>
                อัปเดตเลย
              </button>
            )}
          </div>
          {downloadProgress !== null && (
            <div className="progress-wrap">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${downloadProgress}%` }}></div>
              </div>
              <span style={{ fontSize: '11px', opacity: 0.8 }}>กำลังดาวน์โหลดตัวอัปเดต...</span>
            </div>
          )}
        </div>
      )}

      {checkMsg && <p className="ok" style={{ margin: '0 0 12px', fontSize: '13px' }}>{checkMsg}</p>}

      <label htmlFor="scanned-folder">ที่อยู่ไฟล์สแกน</label>
      <div className="row">
        <input id="scanned-folder" value={dir} readOnly placeholder="เลือกโฟลเดอร์..." />
        <button onClick={browse} disabled={!!url}>
          เลือกโฟลเดอร์
        </button>
      </div>

      <label htmlFor="server-port">พอร์ตเว็บเซิร์ฟเวอร์</label>
      <label htmlFor="server-port">WebView Port</label>
      <div className="row">
        <input
          id="server-port"
          type="number"
          value={port}
          min="1"
          max="65535"
          disabled={!!url}
          onChange={(e) => setPort(e.target.value)}
        />
      </div>

      <label htmlFor="auth-url">URL ระบบยืนยันตัวตน HOSxP (Rservice)</label>
      <label htmlFor="auth-url">URL Rservice Login to HOSxP</label>
      <div className="row">
        <input
          id="auth-url"
          type="text"
          value={authUrl}
          placeholder="http://127.0.0.1:8081"
          disabled={!!url}
          onChange={(e) => handleAuthChange(e.target.value)}
        />
        <button type="button" onClick={testAuth} disabled={!authUrl || testingAuth}>
          {testingAuth ? 'กำลังทดสอบ...' : 'ทดสอบ'}
        </button>
      </div>
      {authStatus && (
        <p className={authStatus.ok ? 'ok' : 'err'} style={{ fontSize: '13px', margin: '4px 0 0' }}>
          {authStatus.msg}
        </p>
      )}

      <button className="primary" onClick={toggle} disabled={!dir}>
        {url ? 'หยุดเว็บเซิร์ฟเวอร์' : 'เริ่มเว็บเซิร์ฟเวอร์'}
      </button>

      {url && (
        <p className="ok">
          กำลังให้บริการ <b>{dir}</b> — เปิดจากเครื่องอื่นได้ที่{' '}
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        </p>
      )}
      {error && <p className="err">{error}</p>}

      <div className="app-meta">
        <span>เวอร์ชัน v{appVersion}</span>
        <a href="#check" onClick={handleManualCheck}>ตรวจสอบเวอร์ชันใหม่</a>
      </div>
    </div>
  )
}

export default App
