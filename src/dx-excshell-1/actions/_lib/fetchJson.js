const fetch = require("node-fetch");

/**
 * Fetch wrapper that returns parsed JSON (or null).
 * Throws with rich error info when response is not OK.
 */
async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Make debugging easier: if a "JSON" endpoint returns HTML/text,
    // surface it via err.responseText on failure.
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

  return data;
}

module.exports = { fetchJson };