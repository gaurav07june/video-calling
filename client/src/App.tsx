import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import VideoGrid from "./components/VideoGrid";
import { createSignalingClient } from "./lib/signaling";
import { createMixedStreamForRecording, createPeerConnection, fetchIceConfig, getDisplayMedia, getMedia, replaceTrackOnSender } from "./lib/webrtc";

type ConnectionState = "idle" | "joining" | "joined" | "calling";

// Normalize server URL (strip trailing slashes). Ensure you set HTTPS in Vercel env.
const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "http://localhost:8080").replace(/\/+$/, "");

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

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const signalingRef = useRef<ReturnType<typeof createSignalingClient> | null>(null);
  const iceConfigRef = useRef<{ iceServers: RTCIceServer[]; publicBaseUrl: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mixedStopRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const canCall = useMemo(() => state === "joined", [state]);

  useEffect(() => {
    // Load ICE config from server
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

  // Ensure local preview attaches after the <video> mounts (joined/calling views)
  useEffect(() => {
    if ((state === "joined" || state === "calling") && localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [state]);

  const initLocalMedia = useCallback(async () => {
    const stream = await getMedia({ audio: true, video: { width: 1280, height: 720 } });
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
  }, []);

  const initPeer = useCallback(() => {
    const iceServers = iceConfigRef.current?.iceServers || [];
    const peer = createPeerConnection(iceServers);
    peer.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = stream;
      } else {
        // Add tracks as they come
        ev.streams.forEach((s) => {
          s.getTracks().forEach((t) => {
            remoteStreamRef.current?.addTrack(t);
          });
        });
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
    };
    peer.onicecandidate = (ev) => {
      if (ev.candidate && roomId) {
        signalingRef.current?.sendIceCandidate(roomId, ev.candidate.toJSON());
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        setMessage("Peer connection lost");
      }
    };
    peerRef.current = peer;
    return peer;
  }, [roomId]);

  const addLocalTracks = useCallback((peer: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((t) => {
      peer.addTrack(t, stream);
    });
  }, []);

  const join = useCallback(async () => {
    if (!roomId || !displayName) {
      setMessage("Enter a display name and room ID");
      return;
    }
    setMessage("");
    setState("joining");
    await initLocalMedia();
    const signaling = createSignalingClient(SERVER_URL, {
      joined_room: async ({ peers }) => {
        setState("joined");
        if (peers.length === 1) {
          // There is already a peer; create offer
          const peer = initPeer();
          addLocalTracks(peer);
          const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await peer.setLocalDescription(offer);
          signalingRef.current?.sendOffer(roomId, offer);
          setState("calling");
        }
      },
      peer_joined: async () => {
        // We will create offer on joined_room if needed. If we are the first, the new peer creates offer.
      },
      offer: async ({ from, sdp }) => {
        if (!peerRef.current) {
          initPeer();
          if (peerRef.current) addLocalTracks(peerRef.current);
        }
        const peer = peerRef.current!;
        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        signalingRef.current?.sendAnswer(roomId, answer);
        setState("calling");
      },
      answer: async ({ sdp }) => {
        if (!peerRef.current) return;
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      },
      ice_candidate: async ({ candidate }) => {
        try {
          await peerRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error(e);
        }
      },
      room_full: () => {
        setMessage("Room is full");
      },
      peer_left: () => {
        setMessage("Peer left");
      },
      error_message: ({ message }) => setMessage(message)
    });
    signalingRef.current = signaling;
    signaling.joinRoom(roomId, displayName);
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url.toString());
  }, [addLocalTracks, displayName, initLocalMedia, initPeer, roomId]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) track.enabled = !track.enabled;
  }, []);

  const toggleCam = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track) track.enabled = !track.enabled;
  }, []);

  const shareScreen = useCallback(async () => {
    const ds = await getDisplayMedia({ video: true, audio: false });
    const videoTrack = ds.getVideoTracks()[0];
    if (!videoTrack) return;
    if (localVideoRef.current) {
      // Display the shared screen locally
      const newLocal = new MediaStream([videoTrack, ...(localStreamRef.current?.getAudioTracks() || [])]);
      localVideoRef.current.srcObject = newLocal;
    }
    if (peerRef.current) {
      replaceTrackOnSender(peerRef.current, videoTrack, "video");
    }
    videoTrack.onended = () => {
      // Revert to camera
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current!;
        }
        if (peerRef.current) {
          replaceTrackOnSender(peerRef.current, camTrack, "video");
        }
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (!localVideoRef.current || !remoteVideoRef.current) return;
    const mixed = createMixedStreamForRecording({
      localVideo: localVideoRef.current,
      remoteVideo: remoteVideoRef.current,
      localAudioStream: localStreamRef.current,
      remoteAudioStream: remoteStreamRef.current
    });
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
      // Upload to server
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("roomId", roomId);
        form.append("participant", displayName || "participant");
        const res = await fetch(`${SERVER_URL}/recordings`, { method: "POST", body: form });
        if (res.ok) {
          const data = await res.json();
          if (data?.url) {
            setRecordedUrl(data.url);
          }
        } else {
          // Fallback: local download
          const url = URL.createObjectURL(blob);
          setRecordedUrl(url);
        }
      } catch {
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
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
      peerRef.current?.getSenders().forEach((s) => s.track?.stop());
      peerRef.current?.close();
      peerRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      setState("idle");
      setMessage("Call ended");
    }
  }, [roomId]);

  return (
    <div className="container">
      <div className="topbar">
        <strong>VideoCalling</strong>
        <span className="pill">{state.toUpperCase()}</span>
        <div style={{ flex: 1 }} />
        {recordedUrl ? (
          <a href={recordedUrl} download target="_blank" rel="noreferrer">Recording</a>
        ) : null}
      </div>

      {state === "idle" || state === "joining" ? (
        <div style={{ padding: 16, display: "flex", gap: 8, alignItems: "center" }}>
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
          <button onClick={join} disabled={state === "joining"} className="ok">
            {state === "joining" ? "Joining..." : "Join"}
          </button>
          {message && <span className="pill">{message}</span>}
        </div>
      ) : (
        <>
          <VideoGrid
            localRef={localVideoRef}
            remoteRef={remoteVideoRef}
            localLabel={`${displayName || "You"}`}
            remoteLabel={"Peer"}
          />
          <div className="controls">
            <button onClick={toggleMic}>Mic</button>
            <button onClick={toggleCam}>Cam</button>
            <button onClick={shareScreen}>Share Screen</button>
            {!recording ? (
              <button onClick={startRecording} className="ok">Start Recording</button>
            ) : (
              <button onClick={stopRecording} className="danger">Stop Recording</button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={hangUp} className="danger">Hang Up</button>
            {message && <span className="pill">{message}</span>}
          </div>
        </>
      )}
    </div>
  );
}


