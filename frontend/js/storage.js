const memoryStore = new Map();

function hasLocalStorage() {
  try {
    const key = "__segredo_test__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch (_) {
    return false;
  }
}

const localStorageReady = hasLocalStorage();

export function getItem(key, fallback = "") {
  if (localStorageReady) {
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  }
  return memoryStore.get(key) ?? fallback;
}

export function setItem(key, value) {
  if (localStorageReady) {
    window.localStorage.setItem(key, value);
    return;
  }
  memoryStore.set(key, value);
}

export function removeItem(key) {
  if (localStorageReady) {
    window.localStorage.removeItem(key);
    return;
  }
  memoryStore.delete(key);
}
