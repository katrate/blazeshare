import { useState, useRef, useCallback } from 'react'
import JSZip from 'jszip'
import FileItem, { formatSize } from './FileItem'
import './SenderScreen.css'

const CHUNK_SIZE = 64 * 1024
const MAX_SIZE = 2 * 1024 * 1024 * 1024

// ---- Folder traversal via DataTransferItem (drag-and-drop) ----
async function traverseEntry(entry, zip, zipRoot, onFileProgress) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
    const relative = zipRoot ? zipRoot + '/' + entry.name : entry.name
    const buffer = await file.arrayBuffer()
    zip.file(relative, buffer)
    onFileProgress?.()
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader()
    let entries
    do {
      entries = await new Promise((resolve) => dirReader.readEntries(resolve))
      for (const child of entries) {
        const childPath = zipRoot ? zipRoot + '/' + entry.name : entry.name
        await traverseEntry(child, zip, childPath, onFileProgress)
      }
    } while (entries.length > 0)
  }
}

// Zip items from drag-and-drop DataTransferItemList
async function zipDraggedItems(items, onProgress) {
  const zip = new JSZip()
  const standaloneFiles = []
  let folderName = 'folder'
  let fileCount = 0

  const itemsArray = Array.from(items)
  for (const item of itemsArray) {
    const entry = item.webkitGetAsEntry?.()
    if (!entry) {
      const file = item.getAsFile?.()
      if (file) standaloneFiles.push(file)
      continue
    }

    if (entry.isDirectory) {
      folderName = entry.name
      const dirReader = entry.createReader()
      let entries
      do {
        entries = await new Promise((resolve) => dirReader.readEntries(resolve))
        for (const child of entries) {
          await traverseEntry(child, zip, entry.name, () => {
            fileCount++
            onProgress?.({
              phase: 'reading',
              percent: 8,
              label: `Reading file ${fileCount}...`,
            })
          })
        }
      } while (entries.length > 0)
    } else {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
      standaloneFiles.push(file)
    }
  }

  // Generate zip if we have folder contents
  const zipKeys = Object.keys(zip.files).filter(k => !zip.files[k].dir)
  let zipFile = null
  if (zipKeys.length > 0) {
    onProgress?.({ phase: 'compressing', percent: 15, label: 'Compressing...' })
    const zipBlob = await zip.generateAsync(
      { type: 'blob' },
      (meta) => onProgress?.({
        phase: 'compressing',
        percent: Math.round(15 + meta.percent * 0.85),
        label: `Compressing ${Math.round(meta.percent)}%`,
      })
    )
    zipFile = new File([zipBlob], folderName + '.zip', { type: 'application/zip' })
    zipFile._isZippedFolder = true
  }

  return { zipFile, standaloneFiles }
}

// Zip files from a FileList (e.g. webkitdirectory input) using webkitRelativePath
async function zipFileListFiles(fileList, onProgress) {
  const files = Array.from(fileList)
  if (files.length === 0) return null

  const firstPath = files[0].webkitRelativePath || files[0].name
  const folderName = firstPath.split('/')[0] || 'folder'

  const zip = new JSZip()
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const path = file.webkitRelativePath || file.name
    const buffer = await file.arrayBuffer()
    zip.file(path, buffer)
    onProgress?.({
      phase: 'reading',
      percent: Math.round(((i + 1) / files.length) * 20),
      label: `Reading files (${i + 1}/${files.length})`,
    })
  }

  onProgress?.({ phase: 'compressing', percent: 20, label: 'Compressing...' })
  const zipBlob = await zip.generateAsync(
    { type: 'blob' },
    (meta) => onProgress?.({
      phase: 'compressing',
      percent: Math.round(20 + meta.percent * 0.8),
      label: `Compressing ${Math.round(meta.percent)}%`,
    })
  )
  const zipFile = new File([zipBlob], folderName + '.zip', { type: 'application/zip' })
  zipFile._isZippedFolder = true
  return zipFile
}

export default function SenderScreen({ socket, roomCode, receiverCount, showToast }) {
  const [files, setFiles] = useState([])
  const [text, setText] = useState('')
  const [sentTexts, setSentTexts] = useState([])
  const [zipping, setZipping] = useState(null)
  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const chunkReaders = useRef(new Map())

  const addFile = useCallback((file) => {
    const id = crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

    const fileEntry = {
      id, file, fileName: file.name, fileType: file.type, fileSize: file.size,
      totalChunks, receivedChunks: 0, status: 'Sending...',
      isZippedFolder: !!file._isZippedFolder,
    }
    setFiles(prev => [...prev, fileEntry])

    socket.emit('file-meta', {
      room: roomCode, fileId: id, fileName: file.name, fileType: file.type,
      fileSize: file.size, totalChunks,
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

  // ---- Folder input handler ----
  const handleFolderInput = useCallback(async (e) => {
    const files = e.target.files
    e.target.value = ''
    if (!files || files.length === 0) return

    // Check size of all files individually
    let totalSum = 0
    for (const f of files) totalSum += f.size
    if (totalSum > MAX_SIZE) {
      showToast('Folder exceeds 2GB limit', 'error')
      return
    }

    setZipping({ percent: 0, label: 'Reading files...' })
    try {
      const zipFile = await zipFileListFiles(files, (p) => {
        setZipping({ percent: p.percent, label: p.label })
      })
      if (!zipFile) {
        showToast('Folder is empty', 'info')
        return
      }

      addFile(zipFile)
      showToast(`📁 ${zipFile.name.replace('.zip', '')} added as zip`, 'success')
    } catch (err) {
      showToast('Failed to zip folder', 'error')
    } finally {
      setZipping(null)
    }
  }, [addFile, showToast])

  // ---- Drag-and-drop handler ----
  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    if (!e.dataTransfer.items?.length) return

    // Check if any item is a directory
    let hasFolder = false
    const dropItems = Array.from(e.dataTransfer.items)
    for (const item of dropItems) {
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) { hasFolder = true; break }
    }

    if (hasFolder) {
      setZipping({ percent: 0, label: 'Preparing folder...' })
      try {
        const { zipFile, standaloneFiles } = await zipDraggedItems(dropItems, (p) => {
          setZipping({ percent: p.percent, label: p.label })
        })

        // Add the zipped folder
        if (zipFile) {
          addFile(zipFile)
          showToast(`📁 ${zipFile.name.replace('.zip', '')} added as zip`, 'success')
        }

        // Add standalone files separately
        if (standaloneFiles.length > 0) {
          handleFiles(standaloneFiles)
        }
      } catch (err) {
        showToast('Failed to process dropped items', 'error')
      } finally {
        setZipping(null)
      }
      return
    }

    // No folders — pass through as regular files
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }, [addFile, showToast, handleFiles])

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

  const folderFiles = files.filter(f => f.isZippedFolder)
  const regularFiles = files.filter(f => !f.isZippedFolder)

  return (
    <div className="sender">
      <div className="sender-panel files-panel">
        <h3 className="panel-title">Files &amp; Folders</h3>
        <div className="drop-zone" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
          <div className="drop-icon">📁</div>
          <p className="drop-text">Drop files or folders, or <strong>browse</strong></p>
          <p className="drop-hint">Up to 2GB total · folders shared as single zip</p>
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
            onChange={handleFolderInput} />
        </div>

        {/* Zipping overlay */}
        {zipping && (
          <div className="zipping-overlay">
            <div className="zipping-card">
              <div className="zipping-spinner">
                <svg className="zipping-spinner-ring" viewBox="0 0 50 50">
                  <circle className="zipping-spinner-bg" cx="25" cy="25" r="20" fill="none" strokeWidth="4" />
                  <circle className="zipping-spinner-arc" cx="25" cy="25" r="20" fill="none" strokeWidth="4"
                    strokeDasharray={2 * Math.PI * 20}
                    strokeDashoffset={2 * Math.PI * 20 * (1 - zipping.percent / 100)} />
                </svg>
                <span className="zipping-icon">📦</span>
              </div>
              <p className="zipping-label">{zipping.label}</p>
              <div className="zipping-bar-track">
                <div className="zipping-bar-fill" style={{ width: `${zipping.percent}%` }} />
              </div>
            </div>
          </div>
        )}

        <div className="file-list">
          {/* Zipped folder items */}
          {folderFiles.map(f => (
            <FileItem key={f.id} file={f} onRemove={removeFile} />
          ))}

          {/* Regular files */}
          {regularFiles.map(f => (
            <FileItem key={f.id} file={f} onRemove={removeFile} />
          ))}

          {files.length === 0 && (
            <div className="file-list-empty">
              <p>No files added yet</p>
            </div>
          )}
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
