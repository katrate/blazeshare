import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import FileItem from './FileItem'
import './ReceiverScreen.css'

const ReceiverScreen = forwardRef(function ReceiverScreen({ socket, roomCode }, ref) {
  const [files, setFiles] = useState([])
  const [textContent, setTextContent] = useState('')
  const [textId, setTextId] = useState(null)
  const [copied, setCopied] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const chunksRef = useRef(new Map())

  // ---- Group files by folder ----
  const getFolderGroups = () => {
    const groups = {}
    const standalone = []
    for (const f of files) {
      if (f.relativePath) {
        const root = f.relativePath.split('/')[0]
        if (!groups[root]) groups[root] = []
        groups[root].push(f)
      } else {
        standalone.push(f)
      }
    }
    return { groups, standalone }
  }

  const handleFileMeta = useCallback(({ fileId, fileName, fileType, fileSize, totalChunks, relativePath }) => {
    chunksRef.current.set(fileId, [])
    setFiles(prev => [...prev, {
      id: fileId, fileName, fileType, fileSize, totalChunks,
      receivedChunks: 0, status: 'Receiving...', justArrived: true, ready: false,
      relativePath: relativePath || null,
      isFromFolder: !!relativePath,
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

  // ---- Individual file download ----
  const downloadFile = (file) => {
    const allChunks = chunksRef.current.get(file.id)
    if (!allChunks || allChunks.length === 0) return
    const blob = new Blob(allChunks, { type: file.fileType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    socket.emit('file-downloaded', { room: roomCode, fileId: file.id })
    setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: '✅ Downloaded' } : f))
  }

  // ---- Save all files preserving folder structure ----
  const saveAll = async () => {
    const readyFiles = files.filter(f => f.ready && !f.status.includes('Downloaded'))
    if (readyFiles.length === 0) return

    const hasFolders = readyFiles.some(f => f.relativePath)

    if (hasFolders && 'showDirectoryPicker' in window) {
      // Use File System Access API to preserve folder structure
      setSavingAll(true)
      try {
        const rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' })

        for (const file of readyFiles) {
          const allChunks = chunksRef.current.get(file.id)
          if (!allChunks) continue
          const blob = new Blob(allChunks, { type: file.fileType })

          // Determine save path
          const parts = file.relativePath
            ? file.relativePath.split('/')
            : [file.fileName]

          const fileName = parts.pop()

          // Navigate/create subdirectories
          let dirHandle = rootHandle
          for (const part of parts) {
            dirHandle = await dirHandle.getDirectoryHandle(part, { create: true })
          }

          // Write file
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(blob)
          await writable.close()

          socket.emit('file-downloaded', { room: roomCode, fileId: file.id })
          setFiles(prev => prev.map(f =>
            f.id === file.id ? { ...f, status: '✅ Downloaded' } : f
          ))
        }
      } catch (err) {
        if (err.name !== 'AbortError' && err.name !== 'SecurityError') {
          console.error('Save all error:', err)
        }
      } finally {
        setSavingAll(false)
      }
    } else {
      // No folder structure: download all individually
      for (const file of readyFiles) {
        downloadFile(file)
      }
    }
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

  const { groups, standalone } = getFolderGroups()
  const hasReadyFiles = files.some(f => f.ready && !f.status.includes('Downloaded'))
  const folderCount = Object.keys(groups).length

  return (
    <div className="receiver">
      <div className="receiver-panel">
        <div className="panel-header">
          <h3 className="panel-title">Incoming Files</h3>
          {hasReadyFiles && (
            <button className="save-all-btn" onClick={saveAll} disabled={savingAll}>
              {savingAll ? '💾 Saving...' : folderCount > 0 ? '💾 Save All (with folders)' : '💾 Download All'}
            </button>
          )}
        </div>
        <div className="file-list">
          {files.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon">📡</span>
              <p className="empty-text">Waiting for files...</p>
            </div>
          )}

          {/* Folder groups */}
          {Object.entries(groups).map(([root, groupFiles]) => (
            <div key={root} className="folder-group">
              <div className="folder-header">
                <span className="folder-icon">📂</span>
                <span className="folder-name">{root}</span>
                <span className="folder-count">{groupFiles.length} file{groupFiles.length > 1 ? 's' : ''}</span>
              </div>
              {groupFiles.map(f => (
                <FileItem key={f.id} file={f} onDownload={downloadFile} isReceiver />
              ))}
            </div>
          ))}

          {/* Standalone files */}
          {standalone.map(f => (
            <FileItem key={f.id} file={f} onDownload={downloadFile} isReceiver />
          ))}
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
