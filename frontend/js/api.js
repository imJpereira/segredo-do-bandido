export async function fetchHealth(apiBaseUrl) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(`${apiBaseUrl}/health`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error("health check failed");
    }
    const payload = await response.json();
    return payload.status === "ok";
  } catch (_) {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function adminHeaders(password) {
  return {
    "Content-Type": "application/json",
    "x-admin-password": password,
  };
}

async function parseResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Não foi possível concluir a operação.");
  }
  return data;
}

export async function listQuestions(apiBaseUrl) {
  const response = await fetch(`${apiBaseUrl}/questions`);
  return parseResponse(response);
}

export async function createQuestion(apiBaseUrl, password, payload) {
  const response = await fetch(`${apiBaseUrl}/questions`, {
    method: "POST",
    headers: adminHeaders(password),
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function updateQuestion(apiBaseUrl, password, questionId, payload) {
  const response = await fetch(`${apiBaseUrl}/questions/${questionId}`, {
    method: "PUT",
    headers: adminHeaders(password),
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function deleteQuestion(apiBaseUrl, password, questionId) {
  const response = await fetch(`${apiBaseUrl}/questions/${questionId}`, {
    method: "DELETE",
    headers: adminHeaders(password),
  });
  return parseResponse(response);
}

export async function createRoom(apiBaseUrl, password) {
  const response = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: adminHeaders(password),
  });
  return parseResponse(response);
}

export async function startRoom(apiBaseUrl, password, code) {
  const response = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(code)}/start`, {
    method: "POST",
    headers: adminHeaders(password),
  });
  return parseResponse(response);
}

export async function getRoom(apiBaseUrl, code) {
  const response = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(code)}`);
  return parseResponse(response);
}
