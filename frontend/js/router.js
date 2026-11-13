import { patchState } from "./state.js";

const viewNames = new Set([
  "entry",
  "admin-questions",
  "admin-room",
  "player-lobby",
  "voting",
  "round-result",
  "game-over",
]);

export function setView(view) {
  if (!viewNames.has(view)) {
    return;
  }
  patchState({ currentView: view });
}

export function bindViewButtons() {
  const buttons = document.querySelectorAll("[data-view-target]");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.viewTarget);
    });
  });
}
