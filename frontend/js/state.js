import { getApiBaseUrl } from "./config.js";

const state = {
  currentView: "entry",
  apiBaseUrl: getApiBaseUrl(),
  connectionStatus: "checking",
  realtimeStatus: "idle",
  gameDeadline: null,
  serverNow: null,
  serverNowCapturedAtMs: null,
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getState() {
  return { ...state };
}

export function patchState(partialState) {
  const nextState = { ...partialState };
  if (Object.prototype.hasOwnProperty.call(nextState, "serverNow")) {
    nextState.serverNowCapturedAtMs =
      typeof nextState.serverNow === "number" ? Date.now() : null;
  }
  Object.assign(state, nextState);
  listeners.forEach((listener) => listener(state));
}
