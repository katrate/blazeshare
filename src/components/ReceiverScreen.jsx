import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import FileItem from './FileItem'
import './ReceiverScreen.css'

const ReceiverScreen = forwardRef(function ReceiverScreen({ socket, roomCode }, ref) {
  const [files, setFiles] = useState([])
  const [textContent, setTextContent] = useState('')
  const [textId, setTextId] = useState(null)
  const [copied, setCopied] = useState(false)
  const chunksRef = useRef(new Map())

  const handleFileMeta = useCallback(({ fileId, fileName, fileType, fileSize, totalChunks }) => {
    chunksRef.current.set(fileId, [])
    setFiles(prev => [...prev, {
      id: fileId, fileName, fileType, fileSize, totalChunks,
      receivedChunks: 0, status: 'Receiving...', justArrived: true, ready: false,
    }])
  }, [])

  const handleFileChunk = useCallback(({ fileId, chunkIndex, data }) => {
    const arr = new Uint8Array(data)
    const existing = chunksRef.current.get(fileId) || []
    existing[chunkIndex] = arr
    chunksRef.current.set(fileId, existing)

    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f
      const received = f.receivedChunks + 1
      const ready = received >= f.totalChunks
      return {
        ...f,
        receivedChunks: received,
        status: ready ? '✅ Ready' : `Receiving... ${Math.round((received / f.totalChunks) * 100)}%`,
        ready,
        justArrived: false,
      }
    }))
  }, [])

  const handleFileCancelled = useCallback(({ fileId }) => {
    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: '❌ Cancelled', ready: false } : f))
  }, [])

  const handleReceiveText = useCallback(({ textId: id, content }) => {
    setTextId(id)
    setTextContent(content)
    setCopied(false)
  }, [])

  useImperativeHandle(ref, () => ({
    handleFileMeta,
    handleFileChunk,
    handleFileCancelled,
    handleReceiveText,
  }), [handleFileMeta, handleFileChunk, handleFileCancelled, handleReceiveText])

  const downloadFile = (file) => {
    const allChunks = chunksRef.current.get(file.id)
    if (!allChunks || allChunks.length === 0) return
    const blob = new Blob(allChunks, { type: file.fileType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = file.fileName; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    socket.emit('file-downloaded', { room: roomCode, fileId: file.id })
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: '✅ Downloaded' } : f))
  }

  const copyText = async () => {
    try { await navigator.clipboard.writeText(textContent) }
    catch {
      const ta = document.createElement('textarea')
      ta.value = textContent; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); ta.remove()
    }
    setCopied(true)
    if (textId) socket.emit('text-received', { room: roomCode, textId })
  }

  return (
    <div className="receiver">
      <div className="receiver-panel">
        <h3 className="panel-title">Incoming Files</h3>
        <div className="file-list">
          {files.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon">📡</span>
              <p className="empty-text">Waiting for files...</p>
            </div>
          )}
          {files.map(f => (
            <FileItem key={f.id} file={f} onDownload={downloadFile} isReceiver />
          ))}
        </div>
      </div>

      <div className="receiver-panel center-panel">
        <div className="room-header-row">
          <h3 className="panel-title">Room</h3>
          <div className="room-code-inline">
            <span className="room-code">{roomCode}</span>
          </div>
        </div>
        <div className="status-badge connected">
          <span className="status-dot green" />
          Connected
        </div>
      </div>

      <div className="receiver-panel">
        <h3 className="panel-title">Incoming Text</h3>
        {textContent ? (
          <div className="text-card">
            <div className="text-content">{textContent}</div>
            <div className="text-footer">
              <button className="copy-btn" onClick={copyText}>📋 Copy</button>
              {copied && <span className="copied-badge">Copied!</span>}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">💬</span>
            <p className="empty-text">No text yet</p>
          </div>
        )}
      </div>
    </div>
  )
})

export default ReceiverScreen
