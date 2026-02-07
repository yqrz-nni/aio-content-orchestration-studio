const fetch = require("node-fetch");

/**
 * Standardized fetch wrapper for App Builder actions.
 *
 * - Always reads response text first (Adobe APIs sometimes return non-JSON errors)
 * - Attempts JSON parse automatically
 * - Throws structured errors on non-2xx responses
 */
async function fetchJson(url, options = {}) {
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

  return data ?? text;
}

module.exports = { fetchJson };