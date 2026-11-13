export function buildWsUrl(apiBaseUrl) {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;

export function createRealtimeClient(config) {
  const {
    getApiBaseUrl,
    getSession,
    onConnecting,
    onConnected,
    onDisconnected,
    onSnapshot,
    onLobbyUpdate,
    onGameStarted,
    onQuestion,
    onVoteProgress,
    onRoundResult,
    onTimePenalty,
    onGameWon,
    onGameLost,
    onError,
  } = config;

  let socket = null;
  let reconnectTimerId = null;
  let reconnectAttempts = 0;
  let manuallyClosed = false;

  function clearReconnectTimer() {
    if (!reconnectTimerId) {
      return;
    }
    window.clearTimeout(reconnectTimerId);
    reconnectTimerId = null;
  }

  function currentContext() {
    const session = getSession();
    if (!session?.roomCode) {
      return null;
    }
    return session;
  }

  function safeSend(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }

  function publishJoin() {
    const session = currentContext();
    if (!session) {
      return;
    }
    safeSend({
      type: "join_lobby",
      data: {
        room: session.roomCode,
        player_id: session.playerId,
        nickname: session.nickname,
      },
    });
  }

  function dispatchEvent(rawPayload) {
    const session = currentContext();
    if (!session) {
      return;
    }

    const envelope = rawPayload?.type ? rawPayload : {};
    const eventType = envelope.type;
    const data = envelope.data || {};
    if (data.room && data.room !== session.roomCode) {
      return;
    }

    if (eventType === "lobby_update") {
      onLobbyUpdate?.(data);
      return;
    }
    if (eventType === "snapshot") {
      onSnapshot?.(data);
      return;
    }
    if (eventType === "game_started") {
      onGameStarted?.(data);
      return;
    }
    if (eventType === "question") {
      onQuestion?.(data);
      return;
    }
    if (eventType === "vote_progress") {
      onVoteProgress?.(data);
      return;
    }
    if (eventType === "round_result") {
      onRoundResult?.(data);
      return;
    }
    if (eventType === "time_penalty") {
      onTimePenalty?.(data);
      return;
    }
    if (eventType === "game_won") {
      onGameWon?.(data);
      return;
    }
    if (eventType === "game_lost") {
      onGameLost?.(data);
      return;
    }
    if (eventType === "error") {
      onError?.(data);
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    reconnectAttempts += 1;
    const delay = Math.min(INITIAL_BACKOFF_MS * (2 ** (reconnectAttempts - 1)), MAX_BACKOFF_MS);
    reconnectTimerId = window.setTimeout(() => {
      reconnectTimerId = null;
      connect();
    }, delay);
  }

  function cleanupSocket(targetSocket) {
    if (!targetSocket) {
      return;
    }
    targetSocket.onopen = null;
    targetSocket.onmessage = null;
    targetSocket.onerror = null;
    targetSocket.onclose = null;
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const session = currentContext();
    if (!session) {
      disconnect(true);
      return;
    }

    const wsUrl = buildWsUrl(getApiBaseUrl());
    onConnecting?.();
    manuallyClosed = false;

    const nextSocket = new WebSocket(wsUrl);
    socket = nextSocket;

    nextSocket.onopen = () => {
      if (socket !== nextSocket) {
        return;
      }
      reconnectAttempts = 0;
      clearReconnectTimer();
      publishJoin();
      onConnected?.();
    };

    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket || typeof event.data !== "string") {
        return;
      }
      try {
        const payload = JSON.parse(event.data);
        dispatchEvent(payload);
      } catch (_) {
        // Ignora payload inválido para manter o socket ativo.
      }
    };

    nextSocket.onerror = () => {
      if (socket !== nextSocket) {
        return;
      }
      onDisconnected?.();
    };

    nextSocket.onclose = () => {
      if (socket !== nextSocket) {
        return;
      }
      cleanupSocket(nextSocket);
      socket = null;
      onDisconnected?.();
      if (!manuallyClosed) {
        scheduleReconnect();
      }
    };
  }

  function disconnect(keepIdle = false) {
    manuallyClosed = true;
    clearReconnectTimer();
    if (socket) {
      const activeSocket = socket;
      socket = null;
      cleanupSocket(activeSocket);
      if (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING) {
        activeSocket.close();
      }
    }
    if (!keepIdle) {
      onDisconnected?.();
    }
  }

  function reconnectNow() {
    disconnect(true);
    manuallyClosed = false;
    connect();
  }

  return {
    connect,
    disconnect,
    reconnectNow,
    publishJoin,
  };
}
