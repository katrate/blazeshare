// ============ Socket Connection ============
const socket = io();
const CHUNK_SIZE = 64 * 1024; // 64KB chunks
const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024; // 2GB total limit (capped server-side)

// ============ DOM Refs ============
const screens = {
  lobby: document.getElementById('lobby-screen'),
  sender: document.getElementById('sender-screen'),
  receiver: document.getElementById('receiver-screen'),
  error: document.getElementById('error-screen'),
};

const $ = (id) => document.getElementById(id);
const btnCreate = $('btn-create');
const btnJoin = $('btn-join');
const roomInput = $('room-input');
const senderRoomCode = $('sender-room-code');
const receiverRoomCode = $('receiver-room-code');
const senderStatus = $('sender-status');
const dropZone = $('drop-zone');
const fileInput = $('file-input');
const senderFileList = $('sender-file-list');
const receiverFileList = $('receiver-file-list');
const receiverEmpty = $('receiver-empty');
const btnCopyCode = $('btn-copy-code');
const btnErrorBack = $('btn-error-back');
const errorMessage = $('error-message');
const toastContainer = $('toast-container');

// Text share refs
const textInput = $('text-input');
const btnSendText = $('btn-send-text');
const textCharCount = $('text-char-count');
const receiverTextArea = $('receiver-text-area');
const receiverTextContent = $('receiver-text-content');
const btnCopyText = $('btn-copy-text');
const textCopiedBadge = $('text-copied-badge');

// ============ State ============
let currentRoom = null;
let myRole = null; // 'sender' | 'receiver'
let activeUploads = new Map(); // fileId -> { progress, controller }
let currentTextId = null; // track latest received text ID

// ============ Screen management ============
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ============ Toast ============
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `${icons[type] || 'ℹ️'} ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============ File size formatting ============
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============ File icon by type ============
function getFileIcon(type, name) {
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('pdf')) return '📄';
  if (type.includes('zip') || type.includes('rar') || type.includes('tar')) return '📦';
  if (type.includes('text') || name.endsWith('.txt') || name.endsWith('.md')) return '📝';
  if (type.includes('json') || type.includes('javascript') || type.includes('html')) return '💻';
  return '📎';
}

// ============ Lobby ============
roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleJoin();
});

btnJoin.addEventListener('click', handleJoin);

function handleJoin() {
  const code = roomInput.value.trim().toUpperCase();
  if (code.length !== 6) {
    showToast('Please enter a valid 6-character room code', 'error');
    return;
  }
  socket.emit('join-room', { code });
}

btnCreate.addEventListener('click', () => {
  socket.emit('create-room');
  myRole = 'sender';
});

btnErrorBack.addEventListener('click', () => {
  showScreen('lobby');
  currentRoom = null;
  myRole = null;
});

// ============ Copy Code ============
btnCopyCode.addEventListener('click', () => {
  if (!currentRoom) return;
  navigator.clipboard.writeText(currentRoom).then(() => {
    showToast('Room code copied!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = currentRoom;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Room code copied!', 'success');
  });
});

// ============ Socket Events ============

// -- Room Created --
socket.on('room-created', ({ code }) => {
  currentRoom = code;
  senderRoomCode.textContent = code;
  senderStatus.innerHTML = `<span class="status-dot waiting"></span><span>Waiting for receiver...</span>`;
  senderStatus.className = 'connection-status';
  showScreen('sender');
  showToast(`Room ${code} created! Share the code.`, 'success');
});

// -- Room Joined (receiver) --
socket.on('room-joined', ({ code }) => {
  currentRoom = code;
  receiverRoomCode.textContent = code;
  showScreen('receiver');
  showToast('Connected! Waiting for files...', 'success');
});

// -- Receiver Count Update (notify sender) --
socket.on('receiver-count-update', ({ count }) => {
  if (count === 0) {
    senderStatus.innerHTML = `<span class="status-dot waiting"></span><span>Waiting for receivers...</span>`;
    senderStatus.className = 'connection-status';
  } else {
    const label = count === 1 ? 'receiver' : 'receivers';
    senderStatus.innerHTML = `<span class="status-dot connected"></span><span>${count} ${label} connected</span>`;
    senderStatus.className = 'connection-status connected';
    showToast(`${count} ${label} connected!`, 'success');
  }
});

// -- Sender Disconnected --
socket.on('sender-disconnected', () => {
  showToast('Sender disconnected', 'error');
  // Go back to lobby after a moment
  setTimeout(() => {
    showScreen('lobby');
    currentRoom = null;
    myRole = null;
  }, 2000);
});

// -- Error --
socket.on('error-message', ({ message }) => {
  showToast(message, 'error');
});

// -- File Meta (receiver gets notified of incoming file) --
socket.on('file-meta', ({ fileId, fileName, fileType, fileSize, totalChunks }) => {
  // Hide empty state
  if (receiverEmpty) receiverEmpty.style.display = 'none';

  const item = document.createElement('div');
  item.className = 'file-item just-arrived';
  item.id = `recv-file-${fileId}`;
  item.dataset.fileId = fileId;
  item.dataset.totalChunks = totalChunks;
  item.dataset.receivedChunks = '0';
  item.dataset.fileName = fileName;
  item.dataset.fileType = fileType;

  const icon = getFileIcon(fileType, fileName);

  item.innerHTML = `
    <div class="file-icon">${icon}</div>
    <div class="file-info">
      <div class="file-name">${fileName}</div>
      <div class="file-size">${formatSize(fileSize)} • Receiving...</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    </div>
    <div class="file-actions">
      <button class="btn-download" disabled>
        <span>⏳</span> Receiving
      </button>
    </div>
  `;

  receiverFileList.appendChild(item);
});

// ============ Received chunks buffer (client-side) ============
const receivedChunks = new Map(); // fileId -> Uint8Array[]

// -- File Chunk (receiver accumulates data & updates UI) --
socket.on('file-chunk', ({ fileId, chunkIndex, data }) => {
  // Accumulate chunk data
  const arr = new Uint8Array(data);
  if (!receivedChunks.has(fileId)) {
    receivedChunks.set(fileId, []);
  }
  receivedChunks.get(fileId)[chunkIndex] = arr;

  // Update UI
  const item = document.getElementById(`recv-file-${fileId}`);
  if (!item) return;

  const received = parseInt(item.dataset.receivedChunks) + 1;
  item.dataset.receivedChunks = received;
  const total = parseInt(item.dataset.totalChunks);
  const pct = Math.min(100, Math.round((received / total) * 100));

  const fill = item.querySelector('.progress-fill');
  const sizeEl = item.querySelector('.file-size');
  if (fill) fill.style.width = pct + '%';
  if (sizeEl) sizeEl.textContent = `Receiving... ${pct}%`;

  // When complete, enable download
  if (received >= total) {
    const btn = item.querySelector('.btn-download');
    if (btn) {
      btn.innerHTML = `<span>⬇️</span> Download`;
      btn.disabled = false;
      btn.onclick = () => downloadReceivedFile(fileId, item);
    }
    if (sizeEl) sizeEl.textContent = `✅ Ready to download`;
    item.classList.remove('just-arrived');
    showToast(`File received: ${item.dataset.fileName}`, 'success');
  }
});

// -- File Cancelled --
socket.on('file-cancelled', ({ fileId }) => {
  const item = document.getElementById(`recv-file-${fileId}`);
  if (item) {
    item.style.opacity = '0.4';
    item.querySelector('.file-size').textContent = '❌ Cancelled';
    const btn = item.querySelector('.btn-download');
    if (btn) btn.disabled = true;
  }
  receivedChunks.delete(fileId);
});

// ============ Download received file ============
function downloadReceivedFile(fileId, item) {
  const allChunks = receivedChunks.get(fileId);
  if (!allChunks || allChunks.length === 0) {
    showToast('Error: file data not found', 'error');
    return;
  }

  const blob = new Blob(allChunks, { type: item.dataset.fileType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = item.dataset.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoke after small delay
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  showToast(`Downloaded ${item.dataset.fileName}`, 'success');

  // Notify server to clear its buffer
  socket.emit('file-downloaded', { room: currentRoom, fileId });

  // Clean up local buffer
  receivedChunks.delete(fileId);

  // Visual update
  const btn = item.querySelector('.btn-download');
  if (btn) {
    btn.innerHTML = `<span>✅</span> Downloaded`;
    btn.disabled = true;
  }
  item.querySelector('.file-size').textContent = '✅ Downloaded';
}

// ============ Sender: File Upload ============

// -- Drag & Drop --
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) handleFiles(files);
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFiles(e.target.files);
    fileInput.value = '';
  }
});

// -- Process files --
function handleFiles(files) {
  if (!currentRoom || myRole !== 'sender') {
    showToast('Create a room first!', 'error');
    return;
  }

  let totalSize = 0;
  for (const f of files) totalSize += f.size;

  if (totalSize > MAX_TOTAL_SIZE) {
    showToast('Total file size exceeds the 1GB limit', 'error');
    return;
  }

  for (const file of files) {
    startUpload(file);
  }
}

function startUpload(file) {
  const fileId = crypto.randomUUID ? crypto.randomUUID() : 
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // Show in sender list
  const item = document.createElement('div');
  item.className = 'file-item';
  item.id = `send-file-${fileId}`;
  item.dataset.fileId = fileId;

  const icon = getFileIcon(file.type, file.name);
  item.innerHTML = `
    <div class="file-icon">${icon}</div>
    <div class="file-info">
      <div class="file-name">${file.name}</div>
      <div class="file-size">${formatSize(file.size)} • Sending...</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    </div>
    <div class="file-actions">
      <button class="btn-remove" data-fileid="${fileId}">✕</button>
    </div>
  `;

  senderFileList.appendChild(item);

  // Remove button
  item.querySelector('.btn-remove').addEventListener('click', () => {
    socket.emit('cancel-file', { room: currentRoom, fileId });
    activeUploads.delete(fileId);
    item.remove();
  });

  // Send meta
  socket.emit('file-meta', {
    room: currentRoom,
    fileId,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    totalChunks,
  });

  // Read and send chunks
  const reader = new FileReader();
  let offset = 0;
  let chunkIndex = 0;
  let cancelled = false;

  activeUploads.set(fileId, { cancel: () => { cancelled = true; } });

  function sendNextChunk() {
    if (cancelled) return;

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    reader.onload = (e) => {
      if (cancelled) return;
      const arrayBuffer = e.target.result;

      socket.emit('file-chunk', {
        room: currentRoom,
        fileId,
        chunkIndex,
        data: arrayBuffer,
      });

      chunkIndex++;
      offset += CHUNK_SIZE;
      const pct = Math.min(100, Math.round((offset / file.size) * 100));

      // Update progress
      const fill = item.querySelector('.progress-fill');
      const sizeEl = item.querySelector('.file-size');
      if (fill) fill.style.width = pct + '%';
      if (sizeEl) sizeEl.textContent = `${formatSize(Math.min(offset, file.size))} / ${formatSize(file.size)} • ${pct}%`;

      if (offset < file.size) {
        sendNextChunk();
      } else {
        // Done
        if (sizeEl) sizeEl.textContent = `✅ Sent successfully`;
        showToast(`Sent: ${file.name}`, 'success');
        activeUploads.delete(fileId);
      }
    };
    reader.onerror = () => {
      showToast(`Failed to read file: ${file.name}`, 'error');
      activeUploads.delete(fileId);
      item.remove();
    };
    reader.readAsArrayBuffer(slice);
  }

  sendNextChunk();
}

// ============ Text Sharing ============

// -- Char counter --
textInput.addEventListener('input', () => {
  const len = textInput.value.length;
  textCharCount.textContent = `${len} chars`;
});

// -- Send text (Ctrl+Enter or button) --
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    handleSendText();
  }
});

btnSendText.addEventListener('click', handleSendText);

function handleSendText() {
  const content = textInput.value.trim();
  if (!content) {
    showToast('Type something first!', 'info');
    return;
  }
  if (content.length > 100000) {
    showToast('Text is too long! Maximum 100,000 characters.', 'error');
    return;
  }
  if (!currentRoom || myRole !== 'sender') {
    showToast('Create a room first!', 'error');
    return;
  }

  const textId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const timestamp = Date.now();

  socket.emit('share-text', { room: currentRoom, textId, content, timestamp });

  // Show sent confirmation in sender file list
  const item = document.createElement('div');
  item.className = 'file-item';
  item.id = `send-text-${textId}`;
  item.innerHTML = `
    <div class="file-icon">📝</div>
    <div class="file-info">
      <div class="file-name">Text snippet</div>
      <div class="file-size">${content.length} chars • Sent <span class="text-status">📤 sent</span></div>
    </div>
  `;
  senderFileList.appendChild(item);

  textInput.value = '';
  textCharCount.textContent = '0 chars';
  showToast('Text sent!', 'success');
}

// -- Text delivered acknowledgment --
socket.on('text-delivered', ({ textId }) => {
  const item = document.getElementById(`send-text-${textId}`);
  if (item) {
    const status = item.querySelector('.text-status');
    if (status) status.textContent = '✅ Delivered';
  }
});

// -- Receive text (receiver) --
socket.on('receive-text', ({ textId, content, timestamp }) => {
  currentTextId = textId;
  receiverTextContent.textContent = content;
  receiverTextArea.style.display = 'block';
  textCopiedBadge.style.display = 'none';
  
  // Animate in fresh
  receiverTextArea.style.animation = 'none';
  receiverTextArea.offsetHeight; // trigger reflow
  receiverTextArea.style.animation = 'fadeIn 0.35s ease';

  showToast('Text received!', 'info');
});

// -- Copy text to clipboard --
btnCopyText.addEventListener('click', async () => {
  const text = receiverTextContent.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  textCopiedBadge.style.display = 'inline';
  showToast('Text copied to clipboard!', 'success');

  // Notify server that text was received/copied
  if (currentRoom && currentTextId) {
    socket.emit('text-received', { room: currentRoom, textId: currentTextId });
  }
});

// ============ Handle reconnect / cleanup ============
socket.on('disconnect', () => {
  showToast('Connection lost. Reconnecting...', 'error');
});

socket.on('connect', () => {
  if (currentRoom && myRole === 'receiver') {
    // Try to rejoin
    socket.emit('join-room', { code: currentRoom });
  }
});
