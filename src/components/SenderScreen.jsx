import { useState, useRef, useCallback } from 'react'
import FileItem, { formatSize } from './FileItem'
import './SenderScreen.css'

const CHUNK_SIZE = 64 * 1024
const MAX_SIZE = 2 * 1024 * 1024 * 1024

// ---- Folder traversal helpers (drag-and-drop) ----
async function traverseEntry(entry, basePath) {
  const files = []
  const path = basePath ? basePath + '/' + entry.name : entry.name

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
    file._relativePath = path
    file._isFromFolder = true
    files.push(file)
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader()
    let entries
    do {
      entries = await new Promise((resolve) => dirReader.readEntries(resolve))
      for (const child of entries) {
        const childFiles = await traverseEntry(child, path)
        files.push(...childFiles)
      }
    } while (entries.length > 0)
  }

  return files
}

async function collectFilesFromItems(items) {
  const allFiles = []
  const promises = []

  for (const item of items) {
    const entry = item.webkitGetAsEntry?.()
    if (!entry) continue
    promises.push(traverseEntry(entry, ''))
  }

  const results = await Promise.all(promises)
  for (const result of results) allFiles.push(...result)
  return allFiles
}

// ---- Get folder name from first relativePath ----
function getFolderLabel(files) {
  const fp = files.find(f => f._relativePath || f.relativePath)
  if (!fp) return null
  const path = fp._relativePath || fp.relativePath
  return path.split('/')[0]
}

export default function SenderScreen({ socket, roomCode, receiverCount, showToast }) {
  const [files, setFiles] = useState([])
  const [text, setText] = useState('')
  const [sentTexts, setSentTexts] = useState([])
  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const chunkReaders = useRef(new Map())

  const addFile = useCallback((file) => {
    const id = crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const relativePath = file._relativePath || file.webkitRelativePath || null
    const isFromFolder = !!(file._isFromFolder || file.webkitRelativePath)
    const folderRoot = relativePath ? relativePath.split('/')[0] : null

    const fileEntry = {
      id, file, fileName: file.name, fileType: file.type, fileSize: file.size,
      totalChunks, receivedChunks: 0, status: 'Sending...',
      relativePath,
      isFromFolder,
      folderRoot,
    }
    setFiles(prev => [...prev, fileEntry])

    socket.emit('file-meta', {
      room: roomCode, fileId: id, fileName: file.name, fileType: file.type,
      fileSize: file.size, totalChunks, relativePath,
    })

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

  const handleFiles = useCallback((fileList) => {
    let totalSize = 0
    const items = []
    for (const f of fileList) {
      totalSize += f.size
      items.push(f)
    }
    if (totalSize > MAX_SIZE) { showToast('Total exceeds 2GB limit', 'error'); return }
    for (const f of items) addFile(f)
  }, [addFile, showToast])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    if (e.dataTransfer.items?.length) {
      // Check if any item is a directory
      let hasFolder = false
      for (const item of e.dataTransfer.items) {
        const entry = item.webkitGetAsEntry?.()
        if (entry?.isDirectory) { hasFolder = true; break }
      }

      if (hasFolder) {
        const folderFiles = await collectFilesFromItems(e.dataTransfer.items)
        if (folderFiles.length === 0) {
          showToast('Folder is empty', 'info')
          return
        }
        handleFiles(folderFiles)
        const label = getFolderLabel(folderFiles)
        showToast(`📁 ${label || folderFiles.length + ' files'} added`, 'success')
        return
      }
    }
    // Regular files drop
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }, [handleFiles, showToast])

  const removeFile = useCallback((file) => {
    socket.emit('cancel-file', { room: roomCode, fileId: file.id })
    chunkReaders.current.delete(file.id)
    setFiles(prev => prev.filter(f => f.id !== file.id))
  }, [socket, roomCode])

  const handleSendText = () => {
    const content = text.trim()
    if (!content) { showToast('Type something first!', 'info'); return }
    if (content.length > 100000) { showToast('Text too long!', 'error'); return }
    const textId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    socket.emit('share-text', { room: roomCode, textId, content, timestamp: Date.now() })
    setSentTexts(prev => [...prev, { id: textId, chars: content.length, status: '📤 sent' }])
    setText('')
  }

  // ---- Group files by folder root ----
  const folderGroups = {}
  const standaloneFiles = []
  for (const f of files) {
    if (f.isFromFolder && f.folderRoot) {
      if (!folderGroups[f.folderRoot]) folderGroups[f.folderRoot] = []
      folderGroups[f.folderRoot].push(f)
    } else {
      standaloneFiles.push(f)
    }
  }

  return (
    <div className="sender">
      <div className="sender-panel files-panel">
        <h3 className="panel-title">Files &amp; Folders</h3>
        <div className="drop-zone" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
          <div className="drop-icon">📁</div>
          <p className="drop-text">Drop files or folders, or <strong>browse</strong></p>
          <p className="drop-hint">Up to 2GB total · folders preserve structure</p>
          <div className="browse-buttons">
            <button className="browse-btn" onClick={() => fileInputRef.current?.click()}>
              📄 Select Files
            </button>
            <button className="browse-btn folder-btn" onClick={() => folderInputRef.current?.click()}>
              📂 Select Folder
            </button>
          </div>
          <input ref={fileInputRef} type="file" multiple hidden
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
          <input ref={folderInputRef} type="file" multiple hidden
            {...{ webkitdirectory: '', directory: '' }}
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        </div>

        <div className="file-list">
          {/* Folder groups */}
          {Object.entries(folderGroups).map(([root, groupFiles]) => (
            <div key={root} className="folder-group">
              <div className="folder-header">
                <span className="folder-icon">📂</span>
                <span className="folder-name">{root}</span>
                <span className="folder-count">{groupFiles.length} file{groupFiles.length > 1 ? 's' : ''}</span>
              </div>
              {groupFiles.map(f => (
                <FileItem key={f.id} file={f} onRemove={removeFile} />
              ))}
            </div>
          ))}

          {/* Standalone files */}
          {standaloneFiles.map(f => (
            <FileItem key={f.id} file={f} onRemove={removeFile} />
          ))}
        </div>
      </div>

      <div className="sender-panel text-panel">
        <h3 className="panel-title">Text</h3>
        <textarea className="text-area" placeholder="Type or paste something..." rows={5}
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSendText() }} />
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
