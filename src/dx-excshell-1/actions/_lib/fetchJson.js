const fetch = require("node-fetch");

/**
 * Standardized fetch wrapper for App Builder actions.
 *
 * - Always reads response text first (Adobe APIs sometimes return non-JSON errors)
 * - Attempts JSON parse automatically
 * - Throws structured errors on non-2xx responses
 */
async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }

  if (!response.ok) {
    const error = new Error("Upstream request failed");
    error.status = response.status;
    error.body = data;
    error.url = url;
    throw error;
  }

  return data;
}

module.exports = { fetchJson };