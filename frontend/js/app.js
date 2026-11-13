import { fetchHealth } from "./api.js";
import { setupAdminQuestions } from "./admin-questions.js";
import { getApiBaseUrl, resetApiBaseUrl, saveApiBaseUrl } from "./config.js";
import { bindViewButtons } from "./router.js";
import { setupRoomLobby } from "./room-lobby.js";
import { patchState, subscribe } from "./state.js";
import { buildWsUrl } from "./websocket.js";

let latestState = null;
let countdownTickerId = null;

function renderView(view) {
  document.querySelectorAll(".view").forEach((node) => {
    node.classList.toggle("is-hidden", node.dataset.view !== view);
  });

  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === view);
  });
}

function renderConnectionBadge(status) {
  const badge = document.getElementById("connection-badge");
  if (!badge) {
    return;
  }

  badge.classList.remove("badge-danger", "badge-success", "badge-warning");
  if (status === "online") {
    badge.classList.add("badge-success");
    badge.textContent = "● Conectado";
    return;
  }

  if (status === "checking") {
    badge.classList.add("badge-warning");
    badge.textContent = "● Verificando API";
    return;
  }

  badge.classList.add("badge-danger");
  badge.textContent = "● API indisponível";
}

function renderRealtimeBadge(status) {
  const badge = document.getElementById("realtime-badge");
  if (!badge) {
    return;
  }

  badge.classList.remove("is-hidden", "badge-warning", "badge-success", "badge-danger");
  if (status === "connected") {
    badge.classList.add("badge-success");
    badge.textContent = "● Tempo real ativo";
    return;
  }

  if (status === "reconnecting") {
    badge.classList.add("badge-warning");
    badge.textContent = "Reconectando...";
    return;
  }

  if (status === "failed") {
    badge.classList.add("badge-danger");
    badge.textContent = "Tempo real indisponível";
    return;
  }

  badge.classList.add("is-hidden");
}

function bindSettingsControls() {
  const panel = document.getElementById("settings-panel");
  const toggleButton = document.getElementById("toggle-settings");
  const form = document.getElementById("api-config-form");
  const input = document.getElementById("api-base-url");
  const resetButton = document.getElementById("reset-api-url");
  const feedback = document.getElementById("api-config-feedback");
  const wsLabel = document.getElementById("ws-endpoint-label");

  input.value = getApiBaseUrl();
  wsLabel.textContent = buildWsUrl(getApiBaseUrl());

  toggleButton?.addEventListener("click", () => {
    panel?.classList.toggle("is-hidden");
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = input.value.trim();
    if (!raw) {
      feedback.textContent = "Informe uma URL válida.";
      return;
    }
    saveApiBaseUrl(raw);
    feedback.textContent = "URL salva com sucesso.";
    patchState({ apiBaseUrl: getApiBaseUrl() });
    wsLabel.textContent = buildWsUrl(getApiBaseUrl());
    triggerHealthCheck();
  });

  resetButton?.addEventListener("click", () => {
    const defaultUrl = resetApiBaseUrl();
    input.value = defaultUrl;
    feedback.textContent = "URL padrão restaurada.";
    patchState({ apiBaseUrl: defaultUrl });
    wsLabel.textContent = buildWsUrl(defaultUrl);
    triggerHealthCheck();
  });
}

async function triggerHealthCheck() {
  patchState({ connectionStatus: "checking" });
  const online = await fetchHealth(getApiBaseUrl());
  patchState({ connectionStatus: online ? "online" : "offline" });
}

function startHealthPolling() {
  triggerHealthCheck();
  window.setInterval(triggerHealthCheck, 15000);
}

function formatTimer(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function estimateRemainingMs(state) {
  if (!state || typeof state.gameDeadline !== "number") {
    return null;
  }
  const deadlineMs = state.gameDeadline * 1000;
  const nowMs = Date.now();
  let estimatedServerNowMs = nowMs;
  if (typeof state.serverNow === "number" && typeof state.serverNowCapturedAtMs === "number") {
    const elapsedSinceReferenceMs = nowMs - state.serverNowCapturedAtMs;
    estimatedServerNowMs = (state.serverNow * 1000) + elapsedSinceReferenceMs;
  }
  return Math.max(0, deadlineMs - estimatedServerNowMs);
}

function renderTimer(state) {
  const node = document.getElementById("game-timer");
  if (!node) {
    return;
  }
  const remainingMs = estimateRemainingMs(state);
  node.textContent = remainingMs === null ? "00:00" : formatTimer(remainingMs);
}

function startCountdownTicker() {
  if (countdownTickerId) {
    window.clearInterval(countdownTickerId);
  }
  renderTimer(latestState);
  countdownTickerId = window.setInterval(() => {
    renderTimer(latestState);
  }, 1000);
}

function bootstrap() {
  bindViewButtons();
  bindSettingsControls();
  setupAdminQuestions();
  setupRoomLobby();
  subscribe((state) => {
    latestState = state;
    renderView(state.currentView);
    renderConnectionBadge(state.connectionStatus);
    renderRealtimeBadge(state.realtimeStatus);
    renderTimer(state);
  });
  startCountdownTicker();
  startHealthPolling();
}

bootstrap();
