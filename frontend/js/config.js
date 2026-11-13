import { getItem, setItem, removeItem } from "./storage.js";

const API_BASE_URL_KEY = "segredo.apiBaseUrl";

function normalizeUrl(value) {
  return value.replace(/\/+$/, "");
}

function defaultApiBaseUrl() {
  return "http://localhost:8000";
}

export function getApiBaseUrl() {
  const saved = getItem(API_BASE_URL_KEY);
  return saved ? normalizeUrl(saved) : defaultApiBaseUrl();
}

export function saveApiBaseUrl(value) {
  setItem(API_BASE_URL_KEY, normalizeUrl(value.trim()));
}

export function resetApiBaseUrl() {
  removeItem(API_BASE_URL_KEY);
  return defaultApiBaseUrl();
}
