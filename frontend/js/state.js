import { getApiBaseUrl } from "./config.js";

const state = {
  currentView: "entry",
  apiBaseUrl: getApiBaseUrl(),
  connectionStatus: "checking",
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
  Object.assign(state, partialState);
  listeners.forEach((listener) => listener(state));
}
