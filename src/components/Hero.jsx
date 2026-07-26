import './Hero.css'

export default function Hero({ roomCode, showToast, role, receiverCount }) {
  const isSender = role === 'sender'

  return (
    <header className={`hero ${!roomCode ? 'hero--centered' : ''}`}>
      <div className="hero-top-row">
        <div className="hero-left">
          <h1 className="hero-title">
            <span className="hero-logo">⚡</span>
            BlazeShare
          </h1>
          {!roomCode && (
            <p className="hero-tagline">Share files and text instantly between devices. Nothing is stored. Everything disappears.</p>
          )}
        </div>

        {roomCode && (
          <div className="hero-right">
            <div className="hero-code">
              <span className="hero-code-text">{roomCode}</span>
              <button className="hero-copy-btn" onClick={() => { navigator.clipboard.writeText(roomCode); showToast('Copied!', 'success') }}>📋</button>
            </div>
            {isSender ? (
              <span className={`hero-status ${receiverCount > 0 ? 'connected' : ''}`}>
                <span className={`hero-dot ${receiverCount > 0 ? 'green' : 'orange'}`} />
                {receiverCount > 0 ? `${receiverCount} connected` : 'Waiting for receivers...'}
              </span>
            ) : (
              <span className="hero-status connected">
                <span className="hero-dot green" />
                Connected
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
