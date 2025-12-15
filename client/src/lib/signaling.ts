import { io, Socket } from "socket.io-client";

export type SignalingEvents = {
  joined_room: (payload: { roomId: string; peers: Array<{ socketId: string; displayName: string }> }) => void;
  peer_joined: (payload: { socketId: string; displayName: string }) => void;
  peer_left: (payload: { socketId: string }) => void;
  room_full: (payload: { roomId: string }) => void;
  offer: (payload: { from: string; sdp: RTCSessionDescriptionInit }) => void;
  answer: (payload: { from: string; sdp: RTCSessionDescriptionInit }) => void;
  ice_candidate: (payload: { from: string; candidate: RTCIceCandidateInit }) => void;
  error_message: (payload: { message: string }) => void;
};

export type SignalingClient = {
  socket: Socket;
  joinRoom: (roomId: string, displayName: string) => void;
  sendOffer: (roomId: string, sdp: RTCSessionDescriptionInit) => void;
  sendAnswer: (roomId: string, sdp: RTCSessionDescriptionInit) => void;
  sendIceCandidate: (roomId: string, candidate: RTCIceCandidateInit) => void;
  leaveRoom: (roomId: string) => void;
  close: () => void;
};

export function createSignalingClient(serverUrl: string, handlers: Partial<SignalingEvents>): SignalingClient {
  const socket = io(serverUrl, {
    transports: ["websocket"],
    autoConnect: true
  });

  if (handlers.joined_room) socket.on("joined_room", handlers.joined_room);
  if (handlers.peer_joined) socket.on("peer_joined", handlers.peer_joined);
  if (handlers.peer_left) socket.on("peer_left", handlers.peer_left);
  if (handlers.room_full) socket.on("room_full", handlers.room_full);
  if (handlers.offer) socket.on("offer", handlers.offer);
  if (handlers.answer) socket.on("answer", handlers.answer);
  if (handlers.ice_candidate) socket.on("ice_candidate", handlers.ice_candidate);
  if (handlers.error_message) socket.on("error_message", handlers.error_message);

  return {
    socket,
    joinRoom: (roomId: string, displayName: string) => {
      socket.emit("join_room", { roomId, displayName });
    },
    sendOffer: (roomId: string, sdp: RTCSessionDescriptionInit) => {
      socket.emit("offer", { roomId, sdp });
    },
    sendAnswer: (roomId: string, sdp: RTCSessionDescriptionInit) => {
      socket.emit("answer", { roomId, sdp });
    },
    sendIceCandidate: (roomId: string, candidate: RTCIceCandidateInit) => {
      socket.emit("ice_candidate", { roomId, candidate });
    },
    leaveRoom: (roomId: string) => {
      socket.emit("leave_room", { roomId });
    },
    close: () => {
      socket.disconnect();
    }
  };
}


