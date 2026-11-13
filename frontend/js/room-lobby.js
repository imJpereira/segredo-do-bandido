import { createRoom, getRoom, startRoom } from "./api.js";
import { getItem, removeItem, setItem } from "./storage.js";
import { setView } from "./router.js";
import { getState } from "./state.js";

const PLAYER_ID_KEY = "segredo.playerId";
const LOBBY_ROOM_CODE_KEY = "segredo.lobby.roomCode";
const LOBBY_NICKNAME_KEY = "segredo.lobby.nickname";
const POLL_MS = 2000;
const MAX_PLAYERS = 30;

let lobbyPollTimer = null;
let currentAdminRoomCode = "";

function createPlayerId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function ensurePlayerId() {
  const existing = getItem(PLAYER_ID_KEY);
  if (existing) {
    return existing;
  }
  const generated = createPlayerId();
  setItem(PLAYER_ID_KEY, generated);
  return generated;
}

function setFeedback(node, message, tone = "") {
  node.textContent = message;
  node.classList.remove("feedback-success", "feedback-error");
  if (tone) {
    node.classList.add(tone);
  }
}

function normalizeRoomStatus(status) {
  if (status === "in_progress") {
    return "Em andamento";
  }
  if (status === "won") {
    return "Vitória";
  }
  if (status === "lost") {
    return "Derrota";
  }
  return "Aguardando jogadores";
}

function stopLobbyPolling() {
  if (!lobbyPollTimer) {
    return;
  }
  window.clearInterval(lobbyPollTimer);
  lobbyPollTimer = null;
}

function startLobbyPolling(callback) {
  stopLobbyPolling();
  lobbyPollTimer = window.setInterval(callback, POLL_MS);
}

function getLobbyContext() {
  return {
    roomCode: getItem(LOBBY_ROOM_CODE_KEY, ""),
    nickname: getItem(LOBBY_NICKNAME_KEY, ""),
  };
}

function clearLobbyContext() {
  removeItem(LOBBY_ROOM_CODE_KEY);
  removeItem(LOBBY_NICKNAME_KEY);
}

export function setupRoomLobby() {
  const adminForm = document.getElementById("admin-room-form");
  const adminPassword = document.getElementById("admin-room-password");
  const adminFeedback = document.getElementById("admin-room-feedback");
  const adminRoomCode = document.getElementById("admin-room-code");
  const adminRoomAddress = document.getElementById("admin-room-address");
  const adminPlayers = document.getElementById("admin-room-players");
  const adminStatus = document.getElementById("admin-room-status");
  const adminOpenButton = document.getElementById("admin-open-room");
  const adminStartButton = document.getElementById("admin-start-room");
  const copyButton = document.getElementById("admin-copy-room-code");

  const playerEntryForm = document.getElementById("player-entry-form");
  const playerRoomCode = document.getElementById("player-room-code");
  const playerNickname = document.getElementById("player-nickname");
  const playerFeedback = document.getElementById("player-entry-feedback");
  const playerSubmitButton = document.getElementById("player-entry-submit");

  const lobbyRoomCode = document.getElementById("lobby-room-code");
  const lobbyNickname = document.getElementById("lobby-player-nickname");
  const lobbyCount = document.getElementById("lobby-player-count");
  const lobbyStatus = document.getElementById("lobby-room-status");
  const lobbyFeedback = document.getElementById("lobby-feedback");

  function renderAdminRoom(room) {
    currentAdminRoomCode = room.code || "";
    adminRoomCode.textContent = room.code || "----";
    adminRoomAddress.textContent = room.code
      ? `Acesso: ${window.location.origin} (código ${room.code})`
      : "";
    adminPlayers.textContent = String(room.players?.length || 0);
    adminStatus.textContent = normalizeRoomStatus(room.status);
    adminStartButton.disabled = room.status !== "lobby";
    copyButton.disabled = !room.code;
  }

  async function refreshAdminRoom() {
    if (!currentAdminRoomCode) {
      return;
    }
    try {
      const room = await getRoom(getState().apiBaseUrl, currentAdminRoomCode);
      renderAdminRoom(room);
      if (room.status === "in_progress") {
        setFeedback(adminFeedback, "Partida iniciada com sucesso.", "feedback-success");
        setView("voting");
      }
    } catch (error) {
      setFeedback(adminFeedback, error.message, "feedback-error");
    }
  }

  async function handleOpenRoom(event) {
    event.preventDefault();
    const password = adminPassword.value.trim();
    if (!password) {
      setFeedback(adminFeedback, "Informe a senha administrativa.", "feedback-error");
      return;
    }

    adminOpenButton.disabled = true;
    setFeedback(adminFeedback, "Abrindo sala...");
    try {
      const room = await createRoom(getState().apiBaseUrl, password);
      renderAdminRoom({ ...room, players: [] });
      setFeedback(adminFeedback, "Sala aberta com sucesso.", "feedback-success");
      startLobbyPolling(refreshAdminRoom);
    } catch (error) {
      setFeedback(adminFeedback, error.message, "feedback-error");
    } finally {
      adminOpenButton.disabled = false;
    }
  }

  async function handleStartRoom() {
    const password = adminPassword.value.trim();
    if (!password) {
      setFeedback(adminFeedback, "Informe a senha para iniciar a partida.", "feedback-error");
      return;
    }
    if (!currentAdminRoomCode) {
      setFeedback(adminFeedback, "Abra uma sala antes de iniciar.", "feedback-error");
      return;
    }

    adminStartButton.disabled = true;
    setFeedback(adminFeedback, "Iniciando partida...");
    try {
      await startRoom(getState().apiBaseUrl, password, currentAdminRoomCode);
      await refreshAdminRoom();
    } catch (error) {
      setFeedback(adminFeedback, error.message, "feedback-error");
      adminStartButton.disabled = false;
    }
  }

  async function refreshPlayerLobby() {
    const { roomCode, nickname } = getLobbyContext();
    if (!roomCode || !nickname) {
      stopLobbyPolling();
      return;
    }

    try {
      const room = await getRoom(getState().apiBaseUrl, roomCode);
      lobbyRoomCode.textContent = roomCode;
      lobbyNickname.textContent = nickname;
      lobbyCount.textContent = String(room.players?.length || 0);
      lobbyStatus.textContent = normalizeRoomStatus(room.status);

      if (room.players?.length >= MAX_PLAYERS) {
        setFeedback(lobbyFeedback, "Sala cheia (30 jogadores).", "feedback-error");
      } else {
        setFeedback(lobbyFeedback, "Conectado ao lobby.", "feedback-success");
      }

      if (room.status === "in_progress") {
        setFeedback(lobbyFeedback, "A partida começou.", "feedback-success");
        setView("voting");
      }
    } catch (error) {
      setFeedback(lobbyFeedback, error.message, "feedback-error");
    }
  }

  async function handlePlayerEntry(event) {
    event.preventDefault();

    const roomCode = playerRoomCode.value.trim().toUpperCase();
    const nickname = playerNickname.value.trim();
    if (!roomCode || !nickname) {
      setFeedback(playerFeedback, "Informe código da sala e apelido.", "feedback-error");
      return;
    }

    playerSubmitButton.disabled = true;
    setFeedback(playerFeedback, "Entrando na sala...");
    try {
      const room = await getRoom(getState().apiBaseUrl, roomCode);
      if (room.status !== "lobby" && room.status !== "in_progress") {
        throw new Error("Sala indisponível para entrada.");
      }
      if ((room.players?.length || 0) >= MAX_PLAYERS) {
        throw new Error("A sala está cheia (30 jogadores).");
      }

      ensurePlayerId();
      setItem(LOBBY_ROOM_CODE_KEY, roomCode);
      setItem(LOBBY_NICKNAME_KEY, nickname);
      setFeedback(playerFeedback, "Entrada confirmada.", "feedback-success");
      setView("player-lobby");
      await refreshPlayerLobby();
      startLobbyPolling(refreshPlayerLobby);
    } catch (error) {
      clearLobbyContext();
      setFeedback(playerFeedback, error.message, "feedback-error");
    } finally {
      playerSubmitButton.disabled = false;
    }
  }

  function copyRoomCode() {
    if (!currentAdminRoomCode || !navigator.clipboard) {
      return;
    }
    navigator.clipboard
      .writeText(currentAdminRoomCode)
      .then(() => setFeedback(adminFeedback, "Código copiado.", "feedback-success"))
      .catch(() => setFeedback(adminFeedback, "Não foi possível copiar o código.", "feedback-error"));
  }

  adminForm?.addEventListener("submit", handleOpenRoom);
  adminStartButton?.addEventListener("click", handleStartRoom);
  copyButton?.addEventListener("click", copyRoomCode);
  playerEntryForm?.addEventListener("submit", handlePlayerEntry);

  const cachedLobby = getLobbyContext();
  if (cachedLobby.roomCode && cachedLobby.nickname) {
    setView("player-lobby");
    refreshPlayerLobby();
    startLobbyPolling(refreshPlayerLobby);
  }
}
