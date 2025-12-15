export type IceConfig = {
  iceServers: RTCIceServer[];
  publicBaseUrl: string;
};

export async function fetchIceConfig(serverUrl: string): Promise<IceConfig> {
  const res = await fetch(`${serverUrl}/config`);
  if (!res.ok) throw new Error("Failed to fetch ICE config");
  return res.json();
}

export function createPeerConnection(iceServers: RTCIceServer[]): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers });
}

export async function getMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia(constraints);
}

export async function getDisplayMedia(constraints: DisplayMediaStreamOptions = { video: true, audio: false }): Promise<MediaStream> {
  const navAny = navigator as any;
  if (typeof navAny?.mediaDevices?.getDisplayMedia === "function") {
    return await navAny.mediaDevices.getDisplayMedia(constraints);
  }
  if (typeof navAny?.getDisplayMedia === "function") {
    return await navAny.getDisplayMedia(constraints);
  }
  throw new Error("getDisplayMedia is not supported in this browser");
}

export function replaceTrackOnSender(peer: RTCPeerConnection, newTrack: MediaStreamTrack, kind: "video" | "audio") {
  const sender = peer.getSenders().find((s) => s.track && s.track.kind === kind);
  if (sender) {
    sender.replaceTrack(newTrack);
  } else {
    // Fallback: add track (should not happen in 1:1 flow if added initially)
    peer.addTrack(newTrack);
  }
}

export type MixedStream = {
  stream: MediaStream;
  stop: () => void;
};

export function createMixedStreamForRecording(options: {
  localVideo: HTMLVideoElement;
  remoteVideo: HTMLVideoElement;
  canvasWidth?: number;
  canvasHeight?: number;
  localAudioStream?: MediaStream | null;
  remoteAudioStream?: MediaStream | null;
}): MixedStream {
  const {
    localVideo,
    remoteVideo,
    canvasWidth = 1280,
    canvasHeight = 720,
    localAudioStream,
    remoteAudioStream
  } = options;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctxMaybe = canvas.getContext("2d");
  if (!ctxMaybe) {
    throw new Error("Canvas 2D context not available");
  }
  const ctx: CanvasRenderingContext2D = ctxMaybe;

  let stopped = false;
  function draw() {
    if (stopped) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    // Side-by-side layout
    const w = canvasWidth / 2;
    const h = canvasHeight;
    try {
      if (localVideo.readyState >= 2) {
        ctx.drawImage(localVideo, 0, 0, w, h);
      }
      if (remoteVideo.readyState >= 2) {
        ctx.drawImage(remoteVideo, w, 0, w, h);
      }
    } catch {
      // Drawing may throw if streams change; ignore for continuous rendering
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  const canvasStream = canvas.captureStream(30);

  let audioContext: AudioContext | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  if (localAudioStream || remoteAudioStream) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    destination = audioContext.createMediaStreamDestination();
    if (localAudioStream) {
      const localSource = audioContext.createMediaStreamSource(localAudioStream);
      localSource.connect(destination);
    }
    if (remoteAudioStream) {
      const remoteSource = audioContext.createMediaStreamSource(remoteAudioStream);
      remoteSource.connect(destination);
    }
  }

  const mixed = new MediaStream();
  canvasStream.getVideoTracks().forEach((t) => mixed.addTrack(t));
  if (destination) {
    destination.stream.getAudioTracks().forEach((t) => mixed.addTrack(t));
  }

  const stop = () => {
    stopped = true;
    canvasStream.getTracks().forEach((t) => t.stop());
    if (audioContext) {
      audioContext.close();
    }
  };

  return { stream: mixed, stop };
}


