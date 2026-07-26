import './Hero.css'

export default function Hero({ roomCode, showToast }) {
  return (
    <header className="hero">
      <div className="hero-top-row">
        <h1 className="hero-title">
          <span className="hero-logo">⚡</span>
          BlazeShare
        </h1>
        {roomCode && (
          <div className="hero-code">
            <span className="hero-code-text">{roomCode}</span>
            {showToast && (
              <button className="hero-copy-btn" onClick={() => { navigator.clipboard.writeText(roomCode); showToast('Copied!', 'success') }}>📋</button>
            )}
          </div>
        )}
      </div>
      <p className="hero-tagline">
        Share files and text instantly between devices.<br />
        Nothing is stored. Everything disappears.
      </p>
    </header>
  )
}
