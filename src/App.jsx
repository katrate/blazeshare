import { useState, useEffect, useCallback, useRef } from 'react'
import { io } from 'socket.io-client'
import Hero from './components/Hero'
import LobbyScreen from './components/LobbyScreen'
import SenderScreen from './components/SenderScreen'
import ReceiverScreen from './components/ReceiverScreen'
import Toast, { useToast } from './components/Toast'
import './App.css'

export default function App() {
  const [socket] = useState(() => io())
  const [screen, setScreen] = useState('lobby')
  const [roomCode, setRoomCode] = useState('')
  const [role, setRole] = useState(null) // 'sender' | 'receiver'
  const [receiverCount, setReceiverCount] = useState(0)
  const { toasts, showToast } = useToast()
  const receiverRef = useRef(null)

  // ---- Socket Events ----
  useEffect(() => {
    socket.on('room-created', ({ code }) => {
      setRoomCode(code)
      setRole('sender')
      setScreen('sender')
      showToast(`Room ${code} created!`, 'success')
    })

    socket.on('room-joined', ({ code }) => {
      setRoomCode(code)
      setRole('receiver')
      setScreen('receiver')
      showToast('Connected!', 'success')
    })

    socket.on('receiver-count-update', ({ count }) => {
      setReceiverCount(count)
      if (count > 0) showToast(`${count} receiver${count > 1 ? 's' : ''} connected`, 'success')
    })

    socket.on('sender-disconnected', () => {
      showToast('Sender disconnected', 'error')
      setTimeout(() => { setScreen('lobby'); setRole(null); setRoomCode('') }, 2000)
    })

    socket.on('error-message', ({ message }) => {
      showToast(message, 'error')
    })

    socket.on('text-delivered', ({ textId }) => {
      // could update UI
    })

    socket.on('file-meta', (data) => {
      receiverRef.current?.handleFileMeta?.(data)
    })
    socket.on('file-chunk', (data) => {
      receiverRef.current?.handleFileChunk?.(data)
    })
    socket.on('file-cancelled', (data) => {
      receiverRef.current?.handleFileCancelled?.(data)
    })
    socket.on('receive-text', (data) => {
      receiverRef.current?.handleReceiveText?.(data)
    })

    return () => {
      socket.off('room-created')
      socket.off('room-joined')
      socket.off('receiver-count-update')
      socket.off('sender-disconnected')
      socket.off('error-message')
      socket.off('text-delivered')
      socket.off('file-meta')
      socket.off('file-chunk')
      socket.off('file-cancelled')
      socket.off('receive-text')
    }
  }, [socket, showToast])

  // ---- Reset ----
  const handleBack = () => {
    setScreen('lobby')
    setRole(null)
    setRoomCode('')
    setReceiverCount(0)
  }

  return (
    <div className="app">
      <Hero roomCode={roomCode} showToast={showToast} role={role} receiverCount={receiverCount} />

      <main className="main-content">
        {screen === 'lobby' && (
          <LobbyScreen socket={socket} showToast={showToast} />
        )}
        {screen === 'sender' && (
          <SenderScreen
            socket={socket}
            roomCode={roomCode}
            receiverCount={receiverCount}
            showToast={showToast}
          />
        )}
        {screen === 'receiver' && (
          <ReceiverScreen
            ref={receiverRef}
            socket={socket}
            roomCode={roomCode}
          />
        )}
        {screen === 'error' && (
          <div className="error-screen">
            <span className="error-icon">⚠️</span>
            <p className="error-text">Something went wrong.</p>
            <button className="back-btn" onClick={handleBack}>Back</button>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Streamed through memory &middot; No disk writes &middot; Ephemeral by design</p>
      </footer>

      <Toast toasts={toasts} />
    </div>
  )
}
