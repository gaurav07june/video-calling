import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSignalingClient } from "./lib/signaling";
import {
  createMixedStreamForRecording,
  createPeerConnection,
  fetchIceConfig,
  getDisplayMedia,
  getMedia,
  replaceTrackOnSender
} from "./lib/webrtc";

type ConnectionState = "idle" | "joining" | "in_call";

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "http://localhost:8080").replace(/\/+$/, "");

function MicIcon({ on }: { on: boolean }) {
  return on ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="3" x2="21" y2="21" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <path d="M15 12V6a3 3 0 0 0-5.94-.6" />
      <path d="M5 11a7 7 0 0 0 11.36 5.48" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <polyline points="9,11 12,8 15,11" />
      <line x1="12" y1="8" x2="12" y2="14" />
    </svg>
  );
}

function RecordIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}

function HangUpIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1A16.088 16.088 0 0 0 12 9z" transform="rotate(135 12 12)" />
    </svg>
  );
}

function CamIcon({ on }: { on: boolean }) {
  return on ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <polygon points="22,8 16,12 22,16" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="3" x2="21" y2="21" />
      <path d="M16 16H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
      <path d="M10 6h4a2 2 0 0 1 2 2v4" />
      <polygon points="22,8 16,12 22,16" />
    </svg>
  );
}

type RemotePeer = {
  socketId: string;
  displayName: string;
  stream: MediaStream | null;
};

export default function App() {
  const [displayName, setDisplayName] = useState<string>("");
  const [roomId, setRoomId] = useState<string>(() => {
    const url = new URL(window.location.href);
    return url.searchParams.get("room") || "";
  });
  const [state, setState] = useState<ConnectionState>("idle");
  const [message, setMessage] = useState<string>("");
  const [recording, setRecording] = useState<boolean>(false);
  const [recordedUrl, setRecordedUrl] = useState<string>("");
  const [micOn, setMicOn] = useState<boolean>(true);
  const [camOn, setCamOn] = useState<boolean>(true);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);

  const lobbyVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const signalingRef = useRef<ReturnType<typeof createSignalingClient> | null>(null);
  const iceConfigRef = useRef<{ iceServers: RTCIceServer[]; publicBaseUrl: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mixedStopRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const remoteTileRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => {
    (async () => {
      try {
        const cfg = await fetchIceConfig(SERVER_URL);
        iceConfigRef.current = cfg;
      } catch (e) {
        console.error("Failed to fetch ICE configuration from:", `${SERVER_URL}/config`, e);
        setMessage(`Failed to fetch ICE configuration from ${SERVER_URL}/config`);
      }
    })();
  }, []);

  useEffect(() => {
    if (state !== "idle") return;
    let cancelled = false;
    (async () => {
      try {
        if (!localStreamRef.current) {
          const stream = await getMedia({ audio: true, video: { width: 1280, height: 720 } });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
        }
        const stream = localStreamRef.current;
        if (stream) {
          stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
          stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
          if (lobbyVideoRef.current) lobbyVideoRef.current.srcObject = stream;
        }
      } catch (e) {
        console.error("getUserMedia failed", e);
        setMessage("Camera/microphone permission required");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    if (state === "in_call" && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [state]);

  const applyMic = useCallback((next: boolean) => {
    setMicOn(next);
    const t = localStreamRef.current?.getAudioTracks()[0];
    if (t) t.enabled = next;
  }, []);

  const applyCam = useCallback((next: boolean) => {
    setCamOn(next);
    const t = localStreamRef.current?.getVideoTracks()[0];
    if (t) t.enabled = next;
  }, []);

  const createPeerFor = useCallback((remoteId: string): RTCPeerConnection => {
    const iceServers = iceConfigRef.current?.iceServers || [];
    const pc = createPeerConnection(iceServers);

    // Add our local tracks
    const local = localStreamRef.current;
    if (local) {
      local.getTracks().forEach((t) => pc.addTrack(t, local));
    }

    pc.ontrack = (ev) => {
      let stream = remoteStreamsRef.current.get(remoteId);
      if (!stream) {
        stream = ev.streams[0] || new MediaStream();
        remoteStreamsRef.current.set(remoteId, stream);
      } else {
        // If a different stream container arrives, copy in any missing tracks
        ev.streams[0]?.getTracks().forEach((t) => {
          if (!stream!.getTracks().includes(t)) {
            try { stream!.addTrack(t); } catch {}
          }
        });
      }
      setRemotePeers((prev) => prev.map((p) => (p.socketId === remoteId ? { ...p, stream } : p)));
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        signalingRef.current?.sendIceCandidate(remoteId, ev.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        setMessage(`Connection to a peer failed`);
      }
    };

    peersRef.current.set(remoteId, pc);
    return pc;
  }, []);

  const closePeer = useCallback((remoteId: string) => {
    const pc = peersRef.current.get(remoteId);
    pc?.getSenders().forEach((s) => {
      try { /* don't stop shared local tracks */ } catch {}
    });
    pc?.close();
    peersRef.current.delete(remoteId);
    remoteStreamsRef.current.delete(remoteId);
    remoteTileRefs.current.delete(remoteId);
    setRemotePeers((prev) => prev.filter((p) => p.socketId !== remoteId));
  }, []);

  const join = useCallback(async () => {
    if (!roomId || !displayName) {
      setMessage("Enter a display name and room ID");
      return;
    }
    setMessage("");
    setState("joining");
    if (!localStreamRef.current) {
      try {
        const stream = await getMedia({ audio: true, video: { width: 1280, height: 720 } });
        localStreamRef.current = stream;
      } catch {
        setMessage("Camera/microphone permission required");
        setState("idle");
        return;
      }
    }
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = micOn));
    localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = camOn));

    const signaling = createSignalingClient(SERVER_URL, {
      joined_room: async ({ peers }) => {
        setState("in_call");
        // Initiate an offer to every existing peer
        for (const { socketId, displayName: peerName } of peers) {
          setRemotePeers((prev) =>
            prev.some((p) => p.socketId === socketId)
              ? prev
              : [...prev, { socketId, displayName: peerName, stream: null }]
          );
          const pc = createPeerFor(socketId);
          try {
            const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await pc.setLocalDescription(offer);
            signaling.sendOffer(socketId, offer);
          } catch (err) {
            console.error("Failed to create offer for", socketId, err);
          }
        }
      },
      peer_joined: ({ socketId, displayName: peerName }) => {
        // Newcomer will send US an offer; just track them.
        setRemotePeers((prev) =>
          prev.some((p) => p.socketId === socketId)
            ? prev
            : [...prev, { socketId, displayName: peerName, stream: null }]
        );
      },
      offer: async ({ from, sdp }) => {
        let pc = peersRef.current.get(from);
        if (!pc) {
          pc = createPeerFor(from);
          setRemotePeers((prev) =>
            prev.some((p) => p.socketId === from)
              ? prev
              : [...prev, { socketId: from, displayName: "Peer", stream: null }]
          );
        }
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signaling.sendAnswer(from, answer);
      },
      answer: async ({ from, sdp }) => {
        const pc = peersRef.current.get(from);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      },
      ice_candidate: async ({ from, candidate }) => {
        const pc = peersRef.current.get(from);
        if (!pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("addIceCandidate failed", e);
        }
      },
      room_full: () => {
        setMessage("Room is full");
        setState("idle");
      },
      peer_left: ({ socketId }) => {
        closePeer(socketId);
      },
      error_message: ({ message }) => setMessage(message)
    });
    signalingRef.current = signaling;
    signaling.joinRoom(roomId, displayName);
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url.toString());
  }, [createPeerFor, closePeer, displayName, micOn, camOn, roomId]);

  const shareScreen = useCallback(async () => {
    const ds = await getDisplayMedia({ video: true, audio: false });
    const videoTrack = ds.getVideoTracks()[0];
    if (!videoTrack) return;
    if (localVideoRef.current) {
      const newLocal = new MediaStream([videoTrack, ...(localStreamRef.current?.getAudioTracks() || [])]);
      localVideoRef.current.srcObject = newLocal;
    }
    peersRef.current.forEach((pc) => replaceTrackOnSender(pc, videoTrack, "video"));
    videoTrack.onended = () => {
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current!;
        }
        peersRef.current.forEach((pc) => replaceTrackOnSender(pc, camTrack, "video"));
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (!localVideoRef.current) return;
    const remoteVideos = Array.from(remoteTileRefs.current.values());
    const videos = [localVideoRef.current, ...remoteVideos];
    const audioStreams = [localStreamRef.current, ...Array.from(remoteStreamsRef.current.values())];
    const mixed = createMixedStreamForRecording({ videos, audioStreams });
    mixedStopRef.current = mixed.stop;
    const rec = new MediaRecorder(mixed.stream, { mimeType: "video/webm;codecs=vp9,opus" });
    chunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = async () => {
      mixed.stop();
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const file = new File([blob], "recording.webm", { type: "video/webm" });
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("roomId", roomId);
        form.append("participant", displayName || "participant");
        const res = await fetch(`${SERVER_URL}/recordings`, { method: "POST", body: form });
        if (res.ok) {
          const data = await res.json();
          if (data?.url) setRecordedUrl(data.url);
        } else {
          setRecordedUrl(URL.createObjectURL(blob));
        }
      } catch {
        setRecordedUrl(URL.createObjectURL(blob));
      }
      setRecording(false);
    };
    rec.start(1000);
    recorderRef.current = rec;
    setRecording(true);
  }, [displayName, roomId]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    mixedStopRef.current?.();
  }, []);

  const hangUp = useCallback(() => {
    try {
      if (roomId) signalingRef.current?.leaveRoom(roomId);
    } finally {
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      remoteStreamsRef.current.clear();
      remoteTileRefs.current.clear();
      setRemotePeers([]);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      signalingRef.current?.close();
      signalingRef.current = null;
      setState("idle");
      setMessage("Call ended");
    }
  }, [roomId]);

  const isLobby = state === "idle" || state === "joining";
  const totalTiles = 1 + remotePeers.length;
  const gridClass = useMemo(() => {
    if (totalTiles <= 1) return "one";
    if (totalTiles === 2) return "two";
    if (totalTiles <= 4) return "four";
    if (totalTiles <= 6) return "six";
    return "many";
  }, [totalTiles]);

  return (
    <div className="container">
      <div className="topbar">
        <strong className="brand">AAG Connect</strong>
        {!isLobby && <span className="pill">{state.toUpperCase()}</span>}
        <div style={{ flex: 1 }} />
        {recordedUrl ? (
          <a href={recordedUrl} download target="_blank" rel="noreferrer">Recording</a>
        ) : null}
      </div>

      {isLobby ? (
        <div className="lobby">
          <div className="lobby-preview">
            <video ref={lobbyVideoRef} autoPlay muted playsInline />
            {!camOn && <div className="cam-off-overlay">Camera is off</div>}
            <div className="name-tag">{displayName || "You"}</div>
            <div className="preview-controls">
              <button
                className={`icon ${micOn ? "" : "off"}`}
                onClick={() => applyMic(!micOn)}
                title={micOn ? "Mute" : "Unmute"}
              >
                <MicIcon on={micOn} />
              </button>
              <button
                className={`icon ${camOn ? "" : "off"}`}
                onClick={() => applyCam(!camOn)}
                title={camOn ? "Turn off camera" : "Turn on camera"}
              >
                <CamIcon on={camOn} />
              </button>
            </div>
          </div>

          <div className="lobby-right">
            <h1>Ready to join?</h1>
            <div className="join-fields">
              <input
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <input
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              />
            </div>
            <button onClick={join} disabled={state === "joining"} className="join-btn">
              {state === "joining" ? "Joining..." : "Join now"}
            </button>
            {message && <span className="pill">{message}</span>}
          </div>
        </div>
      ) : (
        <div className="call-view">
          <div className={`grid ${gridClass}`}>
            <div className="video-card">
              <div className="pill">{displayName || "You"}</div>
              <div className="video-wrapper">
                <video ref={localVideoRef} autoPlay muted playsInline />
                {!camOn && <div className="cam-off-overlay">Camera is off</div>}
              </div>
            </div>
            {remotePeers.map((p) => (
              <RemotePeerTile
                key={p.socketId}
                peer={p}
                registerRef={(el) => {
                  if (el) remoteTileRefs.current.set(p.socketId, el);
                  else remoteTileRefs.current.delete(p.socketId);
                }}
              />
            ))}
          </div>
          {remotePeers.length === 0 && (
            <div className="waiting-hint">Waiting for other participants to join…</div>
          )}
          <div className="floating-controls">
            <button
              className={`icon ${micOn ? "" : "off"}`}
              onClick={() => applyMic(!micOn)}
              title={micOn ? "Mute" : "Unmute"}
            >
              <MicIcon on={micOn} />
            </button>
            <button
              className={`icon ${camOn ? "" : "off"}`}
              onClick={() => applyCam(!camOn)}
              title={camOn ? "Turn off camera" : "Turn on camera"}
            >
              <CamIcon on={camOn} />
            </button>
            <button className="icon" onClick={shareScreen} title="Share screen">
              <ShareIcon />
            </button>
            <button
              className={`icon ${recording ? "off" : ""}`}
              onClick={recording ? stopRecording : startRecording}
              title={recording ? "Stop recording" : "Start recording"}
            >
              <RecordIcon active={recording} />
            </button>
            <button className="icon hangup" onClick={hangUp} title="Hang up">
              <HangUpIcon />
            </button>
          </div>
          {message && <div className="floating-message"><span className="pill">{message}</span></div>}
        </div>
      )}
    </div>
  );
}

function RemotePeerTile({
  peer,
  registerRef
}: {
  peer: RemotePeer;
  registerRef: (el: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      registerRef(ref.current);
      if (peer.stream) {
        ref.current.srcObject = peer.stream;
      }
    }
    return () => registerRef(null);
  }, [peer.stream, registerRef]);
  return (
    <div className="video-card">
      <div className="pill">{peer.displayName || "Peer"}</div>
      <div className="video-wrapper">
        <video ref={ref} autoPlay playsInline />
        {!peer.stream && <div className="cam-off-overlay">Connecting…</div>}
      </div>
    </div>
  );
}
