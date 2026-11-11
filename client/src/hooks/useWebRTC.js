import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ICE_SERVERS } from '../services/config.js';

/**
 * Mesh WebRTC (every person connects directly to every other person, max 5).
 * Signalling (offer / answer / ICE) travels over the room's existing WebSocket as rtc_* events.
 * Uses the "perfect negotiation" pattern so both sides can renegotiate safely (screen share
 * adds a track later). The side with the smaller userId is "polite" and yields on collisions.
 */
export function useWebRTC({ send, subscribe, me, screenShare, onToast }) {
  const [inCall, setInCall] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [, bump] = useReducer((x) => x + 1, 0);

  const pcs = useRef(new Map()); // userId -> { pc, polite, makingOffer, ignoreOffer, streams, screenSenders, chain }
  const localRef = useRef(null);
  const screenRef = useRef(null);
  const inCallRef = useRef(false);
  const micRef = useRef(true);
  const camRef = useRef(true);
  const meRef = useRef(me);
  meRef.current = me;
  const shareRef = useRef(screenShare);
  shareRef.current = screenShare;
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  const closePeer = useCallback((id) => {
    const entry = pcs.current.get(id);
    if (!entry) return;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onnegotiationneeded = null;
    entry.pc.close();
    pcs.current.delete(id);
    bump();
  }, []);

  const createPeer = useCallback(
    (remoteId) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const entry = {
        pc,
        polite: meRef.current.userId < remoteId,
        makingOffer: false,
        ignoreOffer: false,
        streams: new Map(),
        screenSenders: [],
        chain: Promise.resolve(), // signals for one peer are processed strictly in order
      };
      pcs.current.set(remoteId, entry);

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) send('rtc_ice', { to: remoteId, candidate: candidate.toJSON() });
      };
      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          send('rtc_offer', { to: remoteId, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        } catch (err) {
          console.error('negotiation failed', err);
        } finally {
          entry.makingOffer = false;
        }
      };
      pc.ontrack = ({ track, streams }) => {
        const stream = streams[0] || new MediaStream([track]);
        entry.streams.set(stream.id, stream);
        stream.onremovetrack = () => bump();
        track.onunmute = () => bump();
        bump();
      };
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') pc.restartIce();
      };

      // Our camera/mic, plus the screen if we are already sharing.
      const local = localRef.current;
      if (local) local.getTracks().forEach((t) => pc.addTrack(t, local));
      for (const kind of ['audio', 'video']) {
        if (!local || local.getTracks().every((t) => t.kind !== kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
      }
      const screen = screenRef.current;
      if (screen) screen.getTracks().forEach((t) => entry.screenSenders.push(pc.addTrack(t, screen)));
      return entry;
    },
    [send]
  );

  const handleDescription = useCallback(
    (from, description) => {
      const entry = pcs.current.get(from) || createPeer(from);
      entry.chain = entry.chain
        .then(async () => {
          const { pc } = entry;
          const collision = description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
          entry.ignoreOffer = !entry.polite && collision; // the impolite side ignores a colliding offer
          if (entry.ignoreOffer) return;
          await pc.setRemoteDescription(description);
          if (description.type === 'offer') {
            await pc.setLocalDescription();
            send('rtc_answer', { to: from, description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
          }
        })
        .catch((err) => console.error('rtc description failed', err));
    },
    [createPeer, send]
  );

  const handleIce = useCallback((from, candidate) => {
    const entry = pcs.current.get(from);
    if (!entry) return;
    entry.chain = entry.chain.then(async () => {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!entry.ignoreOffer) console.warn('ICE candidate rejected', err);
      }
    });
  }, []);

  const stopScreenShare = useCallback(
    (notifyServer = true) => {
      const stream = screenRef.current;
      if (!stream) return;
      pcs.current.forEach((entry) => {
        entry.screenSenders.forEach((sender) => {
          try {
            entry.pc.removeTrack(sender);
          } catch {
            /* connection already closed */
          }
        });
        entry.screenSenders = [];
      });
      stream.getTracks().forEach((t) => t.stop());
      screenRef.current = null;
      setScreenStream(null);
      if (notifyServer) send('screen_share_stop');
    },
    [send]
  );

  const leaveCall = useCallback(
    (notifyServer = true) => {
      stopScreenShare(false); // the server also ends the share when we leave the call
      [...pcs.current.keys()].forEach(closePeer);
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      setLocalStream(null);
      inCallRef.current = false;
      setInCall(false);
      if (notifyServer) send('rtc_leave');
    },
    [closePeer, send, stopScreenShare]
  );

  const joinCall = useCallback(async () => {
    if (inCallRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toastRef.current?.('Calls need a modern browser and HTTPS.', 'error');
      return;
    }
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        toastRef.current?.('Camera not available, joined with voice only.');
      } catch {
        toastRef.current?.('No microphone or camera access. You can listen and watch only.');
      }
    }
    const hasAudio = Boolean(stream?.getAudioTracks().length);
    const hasVideo = Boolean(stream?.getVideoTracks().length);
    localRef.current = stream;
    setLocalStream(stream);
    micRef.current = hasAudio;
    camRef.current = hasVideo;
    setMicOn(hasAudio);
    setCamOn(hasVideo);
    inCallRef.current = true;
    setInCall(true);
    send('rtc_join', { audio: hasAudio, video: hasVideo });
  }, [send]);

  const toggleMic = useCallback(() => {
    const next = !micRef.current;
    localRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    micRef.current = next;
    setMicOn(next);
    send('rtc_media', { audio: next, video: camRef.current });
  }, [send]);

  const toggleCam = useCallback(() => {
    const next = !camRef.current;
    localRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
    camRef.current = next;
    setCamOn(next);
    send('rtc_media', { audio: micRef.current, video: next });
  }, [send]);

  const startScreenShare = useCallback(async () => {
    if (!inCallRef.current || screenRef.current) return;
    const current = shareRef.current;
    if (current && current.userId !== meRef.current.userId) {
      toastRef.current?.(`${current.username} is already sharing their screen`, 'error');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return; // the user cancelled the picker
    }
    screenRef.current = stream;
    setScreenStream(stream);
    send('screen_share_start', { streamId: stream.id }); // tells everyone which incoming stream is the screen
    pcs.current.forEach((entry) => {
      stream.getTracks().forEach((t) => entry.screenSenders.push(entry.pc.addTrack(t, stream)));
    });
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopScreenShare());
  }, [send, stopScreenShare]);

  // Signalling events from the server.
  useEffect(() => {
    const offs = [
      // We just joined: we are the newcomer, so we offer to everybody already in the call.
      subscribe('rtc_peers', ({ peers }) => {
        if (!inCallRef.current) return;
        peers.forEach((p) => {
          closePeer(p.userId);
          createPeer(p.userId);
        });
      }),
      // Somebody new (or somebody who refreshed their page): drop any old connection, they will offer to us.
      subscribe('rtc_peer_joined', ({ userId }) => closePeer(userId)),
      subscribe('rtc_peer_left', ({ userId }) => closePeer(userId)),
      subscribe('rtc_offer', ({ from, description }) => inCallRef.current && handleDescription(from, description)),
      subscribe('rtc_answer', ({ from, description }) => inCallRef.current && handleDescription(from, description)),
      subscribe('rtc_ice', ({ from, candidate }) => inCallRef.current && handleIce(from, candidate)),
      subscribe('error', ({ code }) => {
        if (code === 'CALL_FULL') leaveCall(false);
        if (code === 'SCREEN_BUSY') stopScreenShare(false);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [subscribe, closePeer, createPeer, handleDescription, handleIce, leaveCall, stopScreenShare]);

  // Leaving the page ends the call locally (camera light off).
  useEffect(
    () => () => {
      screenRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current?.getTracks().forEach((t) => t.stop());
      pcs.current.forEach((entry) => entry.pc.close());
      pcs.current.clear();
    },
    []
  );

  /** The camera stream of a remote person (screen streams are excluded). */
  const getStream = (userId) => {
    const entry = pcs.current.get(userId);
    if (!entry) return null;
    const screenId = shareRef.current?.streamId;
    return [...entry.streams.values()].find((s) => s.id !== screenId && s.getTracks().length > 0) || null;
  };

  /** The shared screen: ours, or the incoming stream whose id the sharer announced. */
  const getScreen = () => {
    const share = shareRef.current;
    if (!share) return null;
    if (share.userId === meRef.current?.userId) return screenRef.current;
    for (const entry of pcs.current.values()) {
      const stream = entry.streams.get(share.streamId);
      if (stream && stream.getTracks().length > 0) return stream;
    }
    return null;
  };

  return {
    inCall,
    micOn,
    camOn,
    localStream,
    screenStream,
    sharing: Boolean(screenStream),
    joinCall,
    leaveCall,
    toggleMic,
    toggleCam,
    startScreenShare,
    stopScreenShare,
    getStream,
    getScreen,
  };
}
