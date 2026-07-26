import { useState } from 'react'
import './LobbyScreen.css'

export default function LobbyScreen({ socket, showToast }) {
  const [code, setCode] = useState('')

  const handleJoin = () => {
    const val = code.trim().toUpperCase()
    if (val.length !== 6) {
      showToast('Enter a valid 6-character code', 'error')
      return
    }
    socket.emit('join-room', { code: val })
  }

  const handleCreate = () => {
    socket.emit('create-room')
  }

  return (
    <div className="lobby">
      <div className="lobby-card create-card" onClick={handleCreate}>
        <span className="lobby-card-icon">📤</span>
        <span className="lobby-card-title">Create Room</span>
        <span className="lobby-card-desc">Send files as the host</span>
      </div>

      <div className="lobby-divider">
        <span>or join one</span>
      </div>

      <div className="lobby-card join-card">
        <span className="lobby-card-icon">🔗</span>
        <span className="lobby-card-title">Join Room</span>
        <span className="lobby-card-desc">Receive files from a host</span>
        <input
          className="lobby-input"
          placeholder="A3F2B1"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
        />
        <button className="lobby-join-btn" onClick={handleJoin}>Connect</button>
      </div>
    </div>
  )
}
