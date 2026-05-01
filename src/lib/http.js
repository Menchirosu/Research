export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "research-trend-threader/0.1",
      accept: "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 400)}`);
  }

  return response.json();
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "research-trend-threader/0.1",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 400)}`);
  }

  return response.text();
}
