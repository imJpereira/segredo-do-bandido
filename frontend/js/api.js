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
