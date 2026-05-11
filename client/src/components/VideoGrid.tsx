import React from "react";

type Props = {
  localRef: React.RefObject<HTMLVideoElement>;
  remoteRef: React.RefObject<HTMLVideoElement>;
  localLabel?: string;
  remoteLabel?: string;
  showRemote?: boolean;
  camOn?: boolean;
};

export default function VideoGrid({ localRef, remoteRef, localLabel, remoteLabel, showRemote = true, camOn = true }: Props) {
  return (
    <div className={`grid ${showRemote ? "two" : "one"}`}>
      <div className="video-card">
        <div className="pill">{localLabel || "You"}</div>
        <div className="video-wrapper">
          <video ref={localRef} autoPlay muted playsInline />
          {!camOn && <div className="cam-off-overlay">Camera is off</div>}
        </div>
      </div>
      <div className="video-card" style={{ display: showRemote ? "flex" : "none" }}>
        <div className="pill">{remoteLabel || "Peer"}</div>
        <div className="video-wrapper">
          <video ref={remoteRef} autoPlay playsInline />
        </div>
      </div>
      {!showRemote && (
        <div className="waiting-hint">Waiting for the other participant to join…</div>
      )}
    </div>
  );
}
