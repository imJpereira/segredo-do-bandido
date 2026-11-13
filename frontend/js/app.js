import { fetchHealth } from "./api.js";
import { setupAdminQuestions } from "./admin-questions.js";
import { getApiBaseUrl, resetApiBaseUrl, saveApiBaseUrl } from "./config.js";
import { bindViewButtons } from "./router.js";
import { patchState, subscribe } from "./state.js";
import { buildWsUrl } from "./websocket.js";

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

function bootstrap() {
  bindViewButtons();
  bindSettingsControls();
  setupAdminQuestions();
  subscribe((state) => {
    renderView(state.currentView);
    renderConnectionBadge(state.connectionStatus);
  });
  startHealthPolling();
}

bootstrap();
