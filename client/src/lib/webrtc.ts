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
    peer.addTrack(newTrack);
  }
}

export type MixedStream = {
  stream: MediaStream;
  stop: () => void;
};

function computeGrid(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  if (n <= 9) return { cols: 3, rows: 3 };
  return { cols: 4, rows: Math.ceil(n / 4) };
}

export function createMixedStreamForRecording(options: {
  videos: HTMLVideoElement[];
  audioStreams: Array<MediaStream | null | undefined>;
  canvasWidth?: number;
  canvasHeight?: number;
}): MixedStream {
  const { videos, audioStreams, canvasWidth = 1280, canvasHeight = 720 } = options;

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
    const n = videos.length;
    if (n > 0) {
      const { cols, rows } = computeGrid(n);
      const cellW = canvasWidth / cols;
      const cellH = canvasHeight / rows;
      for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const v = videos[i];
        try {
          if (v && v.readyState >= 2) {
            ctx.drawImage(v, col * cellW, row * cellH, cellW, cellH);
          }
        } catch {
          // ignore transient drawing errors
        }
      }
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  const canvasStream = canvas.captureStream(30);

  let audioContext: AudioContext | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  const validAudio = audioStreams.filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
  if (validAudio.length > 0) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    destination = audioContext.createMediaStreamDestination();
    for (const s of validAudio) {
      try {
        const src = audioContext.createMediaStreamSource(s);
        src.connect(destination);
      } catch {
        // skip streams that can't be wired
      }
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
