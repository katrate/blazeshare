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
            <span className="hero-roomcode" onClick={() => { navigator.clipboard.writeText(roomCode); showToast('Copied!', 'success') }} title="Click to copy">{roomCode}</span>
            <span className="hero-sep">·</span>
            {isSender ? (
              <span className={`hero-status ${receiverCount > 0 ? 'green' : ''}`}>
                <span className="hero-dot" />
                {receiverCount > 0 ? `${receiverCount} connected` : 'Waiting...'}
              </span>
            ) : (
              <span className="hero-status green">
                <span className="hero-dot" />
                Connected
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
