import './FileItem.css'

const FILE_ICONS = {
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  pdf: '📄',
  zip: '📦',
  text: '📝',
  code: '💻',
}

function getIcon(type, name) {
  if (type?.startsWith('image/')) return FILE_ICONS.image
  if (type?.startsWith('video/')) return FILE_ICONS.video
  if (type?.startsWith('audio/')) return FILE_ICONS.audio
  if (type?.includes('pdf')) return FILE_ICONS.pdf
  if (type?.includes('zip') || type?.includes('rar')) return FILE_ICONS.zip
  return FILE_ICONS.text
}

export function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function FileItem({ file, onDownload, onRemove, isReceiver }) {
  const pct = file.totalChunks ? Math.round((file.receivedChunks / file.totalChunks) * 100) : 0

  return (
    <div className={`file-item ${file.justArrived ? 'just-arrived' : ''}`}>
      <span className="file-icon">{getIcon(file.fileType, file.fileName)}</span>
      <div className="file-info">
        <div className="file-name">{file.fileName}</div>
        <div className="file-meta">
          {file.status || formatSize(file.fileSize)}
        </div>
        {file.totalChunks > 0 && pct < 100 && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: pct + '%' }} />
          </div>
        )}
      </div>
      <div className="file-actions">
        {isReceiver && file.ready && (
          <button className="btn-download" onClick={() => onDownload?.(file)}>⬇️ Download</button>
        )}
        {!isReceiver && (
          <button className="btn-remove" onClick={() => onRemove?.(file)}>✕</button>
        )}
      </div>
    </div>
  )
}
