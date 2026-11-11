import { useEffect, useRef } from 'react';
import { MAX_CALL_PEERS } from '../services/config.js';

function MediaTile({ stream, muted, label, cameraOff, micOff, mirror, big }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return (
    <div className={`tile${big ? ' tile-big' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={muted} className={mirror ? 'mirror' : ''} />
      {(cameraOff || !stream) && !big && <div className="tile-off">{label?.[0]?.toUpperCase() || '?'}</div>}
      <span className="tile-label">{micOff ? '🔇 ' : ''}{label}</span>
    </div>
  );
}

/** Voice / video grid + screen share. All media goes directly between browsers (mesh). */
export default function CallPanel({ rtc, callPeers, me, screenShare }) {
  const remotes = callPeers.filter((p) => p.userId !== me.userId);
  const total = remotes.length + (rtc.inCall ? 1 : 0);
  const screen = rtc.getScreen();
  const someoneElseSharing = screenShare && screenShare.userId !== me.userId;

  if (!rtc.inCall) {
    return (
      <div className="call-bar">
        <span>
          🎙️ Voice &amp; video call{remotes.length > 0 ? ` · ${remotes.length} in the call` : ''}
        </span>
        <button type="button" className="btn btn-small btn-primary" onClick={rtc.joinCall} disabled={remotes.length >= MAX_CALL_PEERS}>
          {remotes.length >= MAX_CALL_PEERS ? 'Call is full' : 'Join call'}
        </button>
      </div>
    );
  }

  return (
    <div className="call">
      {screenShare && (
        <div className="screen-view">
          {screen ? <MediaTile stream={screen} muted big label={`${screenShare.username}'s screen`} /> : <p className="empty">Connecting to {screenShare.username}'s screen...</p>}
        </div>
      )}
      <div className="call-grid">
        <MediaTile stream={rtc.localStream} muted mirror label="You" cameraOff={!rtc.camOn} micOff={!rtc.micOn} />
        {remotes.map((p) => (
          <MediaTile key={p.userId} stream={rtc.getStream(p.userId)} label={p.username} cameraOff={!p.video} micOff={!p.audio} />
        ))}
      </div>
      <div className="call-controls">
        <button type="button" className={`btn btn-small${rtc.micOn ? '' : ' btn-off'}`} onClick={rtc.toggleMic}>{rtc.micOn ? '🎙️ Mute' : '🔇 Unmute'}</button>
        <button type="button" className={`btn btn-small${rtc.camOn ? '' : ' btn-off'}`} onClick={rtc.toggleCam}>{rtc.camOn ? '📷 Camera off' : '📷 Camera on'}</button>
        {rtc.sharing ? (
          <button type="button" className="btn btn-small btn-danger" onClick={() => rtc.stopScreenShare()}>Stop sharing</button>
        ) : (
          <button type="button" className="btn btn-small" onClick={rtc.startScreenShare} disabled={Boolean(someoneElseSharing)} title={someoneElseSharing ? `${screenShare.username} is sharing` : 'Share your screen'}>🖥️ Share screen</button>
        )}
        <button type="button" className="btn btn-small btn-danger" onClick={() => rtc.leaveCall()}>Leave call</button>
        <span className="muted">{total}/{MAX_CALL_PEERS}</span>
      </div>
    </div>
  );
}
