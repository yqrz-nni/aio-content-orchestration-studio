const fetch = require("node-fetch");

/**
 * Fetch wrapper that returns status + headers + parsed body (if any).
 * Use when we need Location headers or when APIs return empty bodies.
 */
async function fetchRaw(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} calling ${url}`);
    err.status = res.status;
    err.url = url;
    err.responseText = text;
    err.data = data;
    throw err;
  }

  const headers = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return { status: res.status, headers, text, data };
}

module.exports = { fetchRaw };