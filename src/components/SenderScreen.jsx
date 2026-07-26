import { useState, useRef, useCallback } from 'react'
import FileItem, { formatSize } from './FileItem'
import './SenderScreen.css'

const CHUNK_SIZE = 64 * 1024
const MAX_SIZE = 2 * 1024 * 1024 * 1024

export default function SenderScreen({ socket, roomCode, receiverCount, showToast }) {
  const [files, setFiles] = useState([])
  const [text, setText] = useState('')
  const [sentTexts, setSentTexts] = useState([])
  const fileInputRef = useRef(null)
  const chunkReaders = useRef(new Map())

  const addFile = useCallback((file) => {
    const id = crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const fileEntry = {
      id, file, fileName: file.name, fileType: file.type, fileSize: file.size,
      totalChunks, receivedChunks: 0, status: 'Sending...',
    }
    setFiles(prev => [...prev, fileEntry])

    socket.emit('file-meta', { room: roomCode, fileId: id, fileName: file.name, fileType: file.type, fileSize: file.size, totalChunks })

    let offset = 0, chunkIndex = 0
    const reader = new FileReader()
    const cancel = () => { chunkReaders.current.delete(id) }
    chunkReaders.current.set(id, cancel)

    const sendNext = () => {
      if (!chunkReaders.current.has(id)) return
      const slice = file.slice(offset, offset + CHUNK_SIZE)
      reader.onload = (e) => {
        if (!chunkReaders.current.has(id)) return
        socket.emit('file-chunk', { room: roomCode, fileId: id, chunkIndex, data: e.target.result })
        chunkIndex++
        offset += CHUNK_SIZE
        const pct = Math.min(100, Math.round((offset / file.size) * 100))
        setFiles(prev => prev.map(f => f.id === id ? { ...f, receivedChunks: chunkIndex, status: `${pct}%` } : f))
        if (offset < file.size) sendNext()
        else setFiles(prev => prev.map(f => f.id === id ? { ...f, status: '✅ Sent' } : f))
      }
      reader.readAsArrayBuffer(slice)
    }
    sendNext()
  }, [socket, roomCode])

  const handleFiles = (fileList) => {
    let totalSize = 0
    for (const f of fileList) totalSize += f.size
    if (totalSize > MAX_SIZE) { showToast('Total exceeds 1GB limit', 'error'); return }
    for (const f of fileList) addFile(f)
  }

  const removeFile = (file) => {
    socket.emit('cancel-file', { room: roomCode, fileId: file.id })
    chunkReaders.current.delete(file.id)
    setFiles(prev => prev.filter(f => f.id !== file.id))
  }

  const handleSendText = () => {
    const content = text.trim()
    if (!content) { showToast('Type something first!', 'info'); return }
    if (content.length > 100000) { showToast('Text too long!', 'error'); return }
    const textId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    socket.emit('share-text', { room: roomCode, textId, content, timestamp: Date.now() })
    setSentTexts(prev => [...prev, { id: textId, chars: content.length, status: '📤 sent' }])
    setText('')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="sender">
      <div className="sender-panel files-panel">
        <h3 className="panel-title">Files</h3>
        <div className="drop-zone" onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}>
          <div className="drop-icon">📁</div>
          <p className="drop-text">Drop files or <strong>browse</strong></p>
          <p className="drop-hint">Up to 1GB total</p>
          <input ref={fileInputRef} type="file" multiple hidden onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        </div>
        <div className="file-list">
          {files.map(f => <FileItem key={f.id} file={f} onRemove={removeFile} />)}
        </div>
      </div>

      <div className="sender-panel text-panel">
        <h3 className="panel-title">Text</h3>
        <textarea className="text-area" placeholder="Type or paste something..." rows={5} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSendText() }} />
        <div className="text-actions">
          <span className="char-count">{text.length || ''}</span>
          <button className="send-text-btn" onClick={handleSendText}>Send ↲</button>
        </div>
        <div className="sent-texts">
          {sentTexts.map(t => (
            <div key={t.id} className="text-item">
              <span>📝</span>
              <span>{t.chars} chars</span>
              <span>{t.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
