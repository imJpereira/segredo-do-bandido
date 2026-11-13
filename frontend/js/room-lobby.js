import { createRoom, getRoom, startRoom, submitVote } from "./api.js";
import { getItem, removeItem, setItem } from "./storage.js";
import { setView } from "./router.js";
import { getState, patchState } from "./state.js";
import { createRealtimeClient } from "./websocket.js";

const PLAYER_ID_KEY = "segredo.playerId";
const LOBBY_ROOM_CODE_KEY = "segredo.lobby.roomCode";
const LOBBY_NICKNAME_KEY = "segredo.lobby.nickname";
const POLL_MS = 2000;
const MAX_PLAYERS = 30;
const TOTAL_ROUNDS = 3;
const OPTION_STYLE_CLASSES = ["option-a", "option-b", "option-c", "option-d"];
const OPTION_LABELS = ["A", "B", "C", "D"];
const LOSS_REASON_LABELS = {
  time_expired: "O tempo acabou.",
};

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
  const votingRoundLabel = document.getElementById("voting-round-label");
  const votingQuestionText = document.getElementById("voting-question-text");
  const votingOptions = document.getElementById("voting-options");
  const votingFeedback = document.getElementById("voting-feedback");
  const votingProgressBar = document.getElementById("voting-progress-bar");
  const votingProgressLabel = document.getElementById("voting-progress-label");
  const roundResultKicker = document.getElementById("round-result-kicker");
  const roundResultTitle = document.getElementById("round-result-title");
  const roundResultCard = document.getElementById("round-result-card");
  const roundResultStatus = document.getElementById("round-result-status");
  const roundResultPenalty = document.getElementById("round-result-penalty");
  const roundResultWinningOption = document.getElementById("round-result-winning-option");
  const roundResultVotes = document.getElementById("round-result-votes");
  const roundResultPercent = document.getElementById("round-result-percent");
  const roundResultCopy = document.getElementById("round-result-copy");
  const gameOverKicker = document.getElementById("game-over-kicker");
  const gameOverTitle = document.getElementById("game-over-title");
  const gameOverCopy = document.getElementById("game-over-copy");
  const gameOverReason = document.getElementById("game-over-reason");
  const gameOverFinishButton = document.getElementById("game-over-finish");
  const playerId = ensurePlayerId();
  let submittingVote = false;
  let optimisticVotedAttemptKey = null;
  let lastSeenRound = null;
  let lastSeenAttempt = null;
  let latestRoundResult = null;
  let latestPenaltySeconds = null;
  let gameFinished = false;

  function playerSession() {
    const { roomCode, nickname } = getLobbyContext();
    if (!roomCode || !nickname) {
      return null;
    }
    return { roomCode, nickname, playerId };
  }

  function startFallbackPolling() {
    startLobbyPolling(refreshPlayerLobby);
  }

  function getVoteAttemptKey(round, attempt) {
    const { roomCode } = getLobbyContext();
    if (!roomCode || !Number.isInteger(round) || !Number.isInteger(attempt)) {
      return null;
    }
    return `${roomCode}:${round}:${attempt}`;
  }

  function hasVotedCurrentAttempt() {
    const appState = getState();
    const votedPlayers = Array.isArray(appState.voteVotedPlayerIds) ? appState.voteVotedPlayerIds : [];
    const round = Number(appState.voteRound);
    const attempt = Number(appState.voteAttempt);
    const attemptKey = getVoteAttemptKey(round, attempt);
    if (!attemptKey) {
      return false;
    }
    if (votedPlayers.includes(playerId)) {
      return true;
    }
    return optimisticVotedAttemptKey === attemptKey;
  }

  function setVotingFeedback(message, tone = "") {
    if (!votingFeedback) {
      return;
    }
    setFeedback(votingFeedback, message, tone);
  }

  function resetRoundResultState() {
    latestRoundResult = null;
    latestPenaltySeconds = null;
  }

  function formatPenalty(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    return `-${safeSeconds}s`;
  }

  function normalizeCounts(rawCounts) {
    const entries = Object.entries(rawCounts || {});
    const mapped = entries.map(([optionId, votes]) => ({
      optionId: Number(optionId),
      votes: Number(votes) || 0,
    }));
    return mapped.filter((item) => Number.isInteger(item.optionId) && item.votes >= 0);
  }

  function describeOption(optionId) {
    const options = Array.isArray(getState().voteOptions) ? getState().voteOptions : [];
    const optionIndex = options.findIndex((item) => item.id === optionId);
    const option = optionIndex >= 0 ? options[optionIndex] : null;
    if (!option) {
      return `ID ${optionId}`;
    }
    const label = OPTION_LABELS[optionIndex] || String(optionIndex + 1);
    return `${label} · ${option.text}`;
  }

  function updateVoteProgress() {
    const appState = getState();
    const voted = Number(appState.voteProgressVoted) || 0;
    const total = Number(appState.voteProgressTotal) || 0;
    if (votingProgressLabel) {
      votingProgressLabel.textContent = `${voted} de ${total} votaram`;
    }
    if (votingProgressBar) {
      const width = total > 0 ? Math.min(100, Math.round((voted / total) * 100)) : 0;
      votingProgressBar.style.width = `${width}%`;
    }
  }

  function applyVoteState(source = {}) {
    const round = Number(source.round) || null;
    const attempt = Number(source.attempt) || null;
    const options = Array.isArray(source.options) ? source.options : [];
    const eliminated = Array.isArray(source.eliminated_options) ? source.eliminated_options : [];
    const progress = source.vote_progress && typeof source.vote_progress === "object"
      ? source.vote_progress
      : {};
    const votedPlayers = Array.isArray(progress.voted_player_ids)
      ? progress.voted_player_ids
      : (Array.isArray(source.voted_player_ids) ? source.voted_player_ids : []);

    const isReopen = (
      Number.isInteger(round) &&
      Number.isInteger(attempt) &&
      Number.isInteger(lastSeenRound) &&
      Number.isInteger(lastSeenAttempt) &&
      round === lastSeenRound &&
      attempt > lastSeenAttempt
    );

    const isNewRound = (
      Number.isInteger(round) &&
      Number.isInteger(lastSeenRound) &&
      round > lastSeenRound
    );

    if (Number.isInteger(round)) {
      lastSeenRound = round;
    }
    if (Number.isInteger(attempt)) {
      lastSeenAttempt = attempt;
    }

    patchState({
      voteRound: round,
      voteAttempt: attempt,
      voteQuestion: typeof source.text === "string" ? source.text : null,
      voteOptions: options,
      voteEliminatedOptionIds: eliminated,
      voteProgressVoted: Number(progress.voted) || 0,
      voteProgressTotal: Number(progress.total) || 0,
      voteVotedPlayerIds: votedPlayers,
    });

    const currentAttemptKey = getVoteAttemptKey(round, attempt);
    if (optimisticVotedAttemptKey && currentAttemptKey && optimisticVotedAttemptKey !== currentAttemptKey) {
      optimisticVotedAttemptKey = null;
    }

    if (isReopen && !hasVotedCurrentAttempt()) {
      setVotingFeedback("Votação reaberta.", "feedback-success");
    } else if (isNewRound) {
      setVotingFeedback("");
    }
  }

  function renderVoting() {
    const appState = getState();
    const round = Number.isInteger(appState.voteRound) ? appState.voteRound : null;
    const attempt = Number.isInteger(appState.voteAttempt) ? appState.voteAttempt : null;
    const options = Array.isArray(appState.voteOptions) ? appState.voteOptions : [];
    const eliminated = new Set(Array.isArray(appState.voteEliminatedOptionIds) ? appState.voteEliminatedOptionIds : []);
    const locked = hasVotedCurrentAttempt() || gameFinished;

    if (votingRoundLabel) {
      const roundText = Number.isInteger(round) ? round : "--";
      votingRoundLabel.textContent = `Rodada ${roundText} de ${TOTAL_ROUNDS}`;
    }
    if (votingQuestionText) {
      votingQuestionText.textContent = appState.voteQuestion || "Aguardando pergunta...";
    }
    updateVoteProgress();

    if (!votingOptions) {
      return;
    }

    votingOptions.innerHTML = "";
    const hasOptions = options.length > 0;
    if (!hasOptions) {
      const placeholder = document.createElement("button");
      placeholder.type = "button";
      placeholder.disabled = true;
      placeholder.className = "option option-a";
      placeholder.textContent = "Aguardando opções...";
      votingOptions.appendChild(placeholder);
      return;
    }

    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `option ${OPTION_STYLE_CLASSES[index % OPTION_STYLE_CLASSES.length]}`;
      const label = OPTION_LABELS[index] || String(index + 1);
      button.textContent = `${label} · ${option.text}`;

      const isEliminated = eliminated.has(option.id);
      if (isEliminated) {
        button.classList.add("option-eliminated");
      }
      const disabled = locked || submittingVote || isEliminated;
      button.disabled = disabled;
      if (!disabled) {
        button.addEventListener("click", () => sendVote(option.id));
      }
      votingOptions.appendChild(button);
    });

    if (locked && votingFeedback && !votingFeedback.textContent) {
      setVotingFeedback("✓ Voto registrado! Aguardando os demais jogadores...", "feedback-success");
    }
    if (!locked && !submittingVote && votingFeedback?.textContent === "Enviando voto...") {
      setVotingFeedback("");
    }
  }

  async function sendVote(optionId) {
    const session = playerSession();
    const appState = getState();
    if (!session || !Number.isInteger(Number(appState.voteRound)) || !Number.isInteger(Number(appState.voteAttempt))) {
      setVotingFeedback("Não foi possível votar agora. Aguarde a próxima atualização.", "feedback-error");
      return;
    }
    if (hasVotedCurrentAttempt() || submittingVote) {
      return;
    }

    submittingVote = true;
    setVotingFeedback("Enviando voto...");
    renderVoting();

    try {
      await submitVote(appState.apiBaseUrl, {
        room: session.roomCode,
        player_id: playerId,
        option_id: optionId,
      });
      optimisticVotedAttemptKey = getVoteAttemptKey(Number(appState.voteRound), Number(appState.voteAttempt));
      const votedPlayers = Array.isArray(appState.voteVotedPlayerIds) ? appState.voteVotedPlayerIds : [];
      patchState({
        voteVotedPlayerIds: votedPlayers.includes(playerId) ? votedPlayers : [...votedPlayers, playerId],
      });
      setVotingFeedback("✓ Voto registrado! Aguardando os demais jogadores...", "feedback-success");
    } catch (error) {
      if (error.message?.includes("já votou")) {
        const votedPlayers = Array.isArray(appState.voteVotedPlayerIds) ? appState.voteVotedPlayerIds : [];
        optimisticVotedAttemptKey = getVoteAttemptKey(Number(appState.voteRound), Number(appState.voteAttempt));
        patchState({
          voteVotedPlayerIds: votedPlayers.includes(playerId) ? votedPlayers : [...votedPlayers, playerId],
        });
        setVotingFeedback("✓ Voto já registrado nesta tentativa.", "feedback-success");
      } else {
        setVotingFeedback(error.message, "feedback-error");
      }
    } finally {
      submittingVote = false;
      renderVoting();
    }
  }

  function renderRoundResult(result) {
    if (!result || typeof result !== "object") {
      return;
    }

    latestRoundResult = result;
    const round = Number(result.round) || Number(getState().voteRound) || null;
    const winnerOptionId = Number(result.winning_option_id);
    const counts = normalizeCounts(result.counts);
    const winnerCount = counts.find((item) => item.optionId === winnerOptionId)?.votes || 0;
    const totalVotes = counts.reduce((acc, item) => acc + item.votes, 0);
    const percent = totalVotes > 0 ? Math.round((winnerCount / totalVotes) * 100) : 0;
    const winnerText = Number.isInteger(winnerOptionId) ? describeOption(winnerOptionId) : "--";

    if (roundResultKicker) {
      roundResultKicker.textContent = Number.isInteger(round)
        ? `Resultado da Rodada ${round}`
        : "Resultado da Rodada";
    }
    if (roundResultTitle) {
      roundResultTitle.textContent = `Maioria da equipe votou em: ${winnerText}`;
    }
    if (roundResultWinningOption) {
      roundResultWinningOption.textContent = winnerText;
    }
    if (roundResultVotes) {
      roundResultVotes.textContent = totalVotes > 0 ? `${winnerCount} voto(s)` : "--";
    }
    if (roundResultPercent) {
      roundResultPercent.textContent = totalVotes > 0 ? `${percent}%` : "--";
    }

    if (roundResultCard) {
      roundResultCard.classList.remove("result-card-danger", "result-card-success");
      roundResultCard.classList.add(result.correct ? "result-card-success" : "result-card-danger");
    }

    if (result.auto) {
      if (roundResultStatus) {
        roundResultStatus.textContent = "✓ Pergunta resolvida automaticamente";
      }
      if (roundResultCopy) {
        roundResultCopy.textContent = "Restava apenas uma alternativa disponível para a equipe.";
      }
    } else if (result.correct) {
      if (roundResultStatus) {
        roundResultStatus.textContent = "✓ Evidência confirmada!";
      }
      if (roundResultCopy) {
        roundResultCopy.textContent = "Boa leitura da equipe. A investigação segue para a próxima rodada.";
      }
    } else {
      if (roundResultStatus) {
        roundResultStatus.textContent = "✕ Opção eliminada";
      }
      if (roundResultCopy) {
        roundResultCopy.textContent = "A alternativa escolhida estava errada. Ajustem a estratégia.";
      }
    }

    if (roundResultPenalty) {
      roundResultPenalty.textContent = "";
      if (result.correct) {
        roundResultPenalty.textContent = "Sem penalidade nesta rodada.";
      }
      if (!result.correct && latestPenaltySeconds !== null) {
        roundResultPenalty.textContent = `Penalidade de tempo: ${formatPenalty(latestPenaltySeconds)}`;
      }
    }

    setView("round-result");
  }

  function applyRoundPenalty(payload) {
    latestPenaltySeconds = Number(payload?.seconds);
    if (
      !Number.isFinite(latestPenaltySeconds) ||
      !latestRoundResult ||
      latestRoundResult.correct
    ) {
      return;
    }
    if (roundResultPenalty) {
      roundResultPenalty.textContent = `Penalidade de tempo: ${formatPenalty(latestPenaltySeconds)}`;
    }
  }

  function readableLossReason(reason) {
    if (!reason) {
      return "A equipe não conseguiu desarmar a bomba a tempo.";
    }
    return LOSS_REASON_LABELS[reason] || "A equipe não conseguiu desarmar a bomba.";
  }

  function renderGameOver(status, reason = null) {
    gameFinished = true;
    submittingVote = false;

    if (status === "won") {
      if (gameOverKicker) {
        gameOverKicker.textContent = "Missão concluída";
      }
      if (gameOverTitle) {
        gameOverTitle.textContent = "✓ BOMBA DESARMADA!";
      }
      if (gameOverCopy) {
        gameOverCopy.textContent = "Parabéns, equipe! Vocês descobriram o segredo do bandido e impediram o crime a tempo.";
      }
      if (gameOverReason) {
        setFeedback(gameOverReason, "Vitória confirmada pelo servidor.", "feedback-success");
      }
      if (gameOverFinishButton) {
        gameOverFinishButton.classList.remove("button-danger");
      }
    } else {
      if (gameOverKicker) {
        gameOverKicker.textContent = "Fim da investigação";
      }
      if (gameOverTitle) {
        gameOverTitle.textContent = "✕ TEMPO ESGOTADO!";
      }
      if (gameOverCopy) {
        gameOverCopy.textContent = "A equipe não conseguiu desarmar a bomba a tempo.";
      }
      if (gameOverReason) {
        setFeedback(gameOverReason, readableLossReason(reason), "feedback-error");
      }
      if (gameOverFinishButton) {
        gameOverFinishButton.classList.add("button-danger");
      }
    }
    renderVoting();
    setView("game-over");
  }

  function resetLocalMatchState() {
    clearLobbyContext();
    stopLobbyPolling();
    realtimeClient.disconnect(true);
    resetRoundResultState();
    gameFinished = false;
    optimisticVotedAttemptKey = null;
    lastSeenRound = null;
    lastSeenAttempt = null;
    patchState({
      realtimeStatus: "idle",
      gameDeadline: null,
      serverNow: null,
      voteRound: null,
      voteAttempt: null,
      voteQuestion: null,
      voteOptions: [],
      voteEliminatedOptionIds: [],
      voteProgressVoted: 0,
      voteProgressTotal: 0,
      voteVotedPlayerIds: [],
    });
    if (lobbyFeedback) {
      setFeedback(lobbyFeedback, "");
    }
    setVotingFeedback("");
    if (gameOverReason) {
      setFeedback(gameOverReason, "");
    }
    setView("entry");
  }

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }

    gameFinished = false;
    lobbyRoomCode.textContent = snapshot.code || "----";
    const connected = Array.isArray(snapshot.players) ? snapshot.players : [];
    lobbyCount.textContent = String(connected.length);
    lobbyStatus.textContent = normalizeRoomStatus(snapshot.status);

    patchState({
      gameDeadline: typeof snapshot.deadline === "number" ? snapshot.deadline : null,
      serverNow: typeof snapshot.server_now === "number" ? snapshot.server_now : null,
    });
    if (snapshot.question) {
      applyVoteState({
        ...snapshot.question,
        vote_progress: snapshot.vote_progress,
      });
    }
    renderVoting();

    if (snapshot.status === "in_progress") {
      setView("voting");
      return;
    }
    if (snapshot.status === "won" || snapshot.status === "lost") {
      renderGameOver(snapshot.status, snapshot.reason ?? null);
      return;
    }
    setView("player-lobby");
  }

  const realtimeClient = createRealtimeClient({
    getApiBaseUrl: () => getState().apiBaseUrl,
    getSession: playerSession,
    onConnecting: () => {
      patchState({ realtimeStatus: "reconnecting" });
      startFallbackPolling();
    },
    onConnected: () => {
      patchState({ realtimeStatus: "connected" });
      stopLobbyPolling();
      refreshPlayerLobby({ quiet: true });
    },
    onDisconnected: () => {
      patchState({ realtimeStatus: "reconnecting" });
      startFallbackPolling();
    },
    onSnapshot: (payload) => {
      if (gameFinished) {
        return;
      }
      applySnapshot(payload);
      setFeedback(lobbyFeedback, "Reconectado e sincronizado com a sala.", "feedback-success");
    },
    onLobbyUpdate: (payload) => {
      if (gameFinished) {
        return;
      }
      const connected = Array.isArray(payload.players) ? payload.players : [];
      lobbyCount.textContent = String(connected.length);
      setFeedback(lobbyFeedback, "Lobby atualizado em tempo real.", "feedback-success");
    },
    onGameStarted: (payload) => {
      gameFinished = false;
      resetRoundResultState();
      if (typeof payload.deadline === "number") {
        patchState({
          gameDeadline: payload.deadline,
          serverNow: typeof payload.server_now === "number" ? payload.server_now : null,
        });
      }
      setFeedback(lobbyFeedback, "A partida começou.", "feedback-success");
      setView("voting");
    },
    onQuestion: (payload) => {
      if (gameFinished) {
        return;
      }
      applyVoteState(payload);
      renderVoting();
      setView("voting");
    },
    onVoteProgress: (payload) => {
      if (gameFinished) {
        return;
      }
      const votedPlayerIds = Array.isArray(payload.voted_player_ids) ? payload.voted_player_ids : [];
      patchState({
        voteProgressVoted: Number(payload.voted) || 0,
        voteProgressTotal: Number(payload.total) || 0,
        voteVotedPlayerIds: votedPlayerIds,
      });
      if (Number(payload.voted) === 0 && Number(getState().voteAttempt) > 1 && !hasVotedCurrentAttempt()) {
        setVotingFeedback("Votação reaberta.", "feedback-success");
      }
      renderVoting();
    },
    onRoundResult: (payload) => {
      if (gameFinished) {
        return;
      }
      renderRoundResult(payload);
    },
    onTimePenalty: (payload) => {
      if (gameFinished) {
        return;
      }
      if (typeof payload.deadline === "number") {
        patchState({
          gameDeadline: payload.deadline,
          serverNow: typeof payload.server_now === "number" ? payload.server_now : null,
        });
      }
      applyRoundPenalty(payload);
    },
    onGameWon: () => {
      resetRoundResultState();
      renderGameOver("won");
    },
    onGameLost: (payload) => {
      resetRoundResultState();
      renderGameOver("lost", payload?.reason ?? null);
    },
    onError: (payload) => {
      if (gameFinished) {
        return;
      }
      if (payload?.message) {
        setVotingFeedback(payload.message, "feedback-error");
      }
    },
  });

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

  async function refreshPlayerLobby(options = {}) {
    const { quiet = false } = options;
    const { roomCode, nickname } = getLobbyContext();
    if (!roomCode || !nickname) {
      stopLobbyPolling();
      realtimeClient.disconnect(true);
      patchState({ realtimeStatus: "idle" });
      return;
    }

    try {
      const room = await getRoom(getState().apiBaseUrl, roomCode);
      lobbyRoomCode.textContent = roomCode;
      lobbyNickname.textContent = nickname;
      lobbyCount.textContent = String(room.players?.length || 0);
      lobbyStatus.textContent = normalizeRoomStatus(room.status);
      patchState({
        gameDeadline: typeof room.deadline === "number" ? room.deadline : null,
        serverNow: typeof room.server_now === "number" ? room.server_now : null,
      });
      if (room.question) {
        applyVoteState({
          ...room.question,
          vote_progress: room.vote_progress,
        });
      }
      renderVoting();

      if (!quiet) {
        if (room.players?.length >= MAX_PLAYERS) {
          setFeedback(lobbyFeedback, "Sala cheia (30 jogadores).", "feedback-error");
        } else {
          setFeedback(lobbyFeedback, "Conectado ao lobby.", "feedback-success");
        }
      } else if (!lobbyFeedback.textContent) {
        setFeedback(lobbyFeedback, "Conectado ao lobby.", "feedback-success");
      }

      if (room.status === "in_progress") {
        gameFinished = false;
        setFeedback(lobbyFeedback, "A partida começou.", "feedback-success");
        setView("voting");
      } else if (room.status === "won" || room.status === "lost") {
        renderGameOver(room.status, room.reason ?? null);
      }
    } catch (error) {
      setFeedback(lobbyFeedback, error.message, "feedback-error");
      patchState({ realtimeStatus: "reconnecting" });
      startFallbackPolling();
    }
  }

  async function handlePlayerEntry(event) {
    event.preventDefault();
    gameFinished = false;

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
      startFallbackPolling();
      realtimeClient.reconnectNow();
    } catch (error) {
      clearLobbyContext();
      realtimeClient.disconnect(true);
      patchState({ realtimeStatus: "idle" });
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

  function handleFinalizeGame() {
    resetLocalMatchState();
  }

  adminForm?.addEventListener("submit", handleOpenRoom);
  adminStartButton?.addEventListener("click", handleStartRoom);
  copyButton?.addEventListener("click", copyRoomCode);
  playerEntryForm?.addEventListener("submit", handlePlayerEntry);
  gameOverFinishButton?.addEventListener("click", handleFinalizeGame);
  renderVoting();

  const cachedLobby = getLobbyContext();
  if (cachedLobby.roomCode && cachedLobby.nickname) {
    setView("player-lobby");
    refreshPlayerLobby();
    startFallbackPolling();
    realtimeClient.connect();
  } else {
    patchState({ realtimeStatus: "idle" });
  }

  window.addEventListener("beforeunload", () => {
    realtimeClient.disconnect(true);
  });
}
