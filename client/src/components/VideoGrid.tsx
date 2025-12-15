import React from "react";

type Props = {
  localRef: React.RefObject<HTMLVideoElement>;
  remoteRef: React.RefObject<HTMLVideoElement>;
  localLabel?: string;
  remoteLabel?: string;
};

export default function VideoGrid({ localRef, remoteRef, localLabel, remoteLabel }: Props) {
  return (
    <div className="grid">
      <div className="video-card">
        <div className="pill">{localLabel || "You"}</div>
        <div className="video-wrapper">
          <video ref={localRef} autoPlay muted playsInline />
        </div>
      </div>
      <div className="video-card">
        <div className="pill">{remoteLabel || "Peer"}</div>
        <div className="video-wrapper">
          <video ref={remoteRef} autoPlay playsInline />
        </div>
      </div>
    </div>
  );
}


