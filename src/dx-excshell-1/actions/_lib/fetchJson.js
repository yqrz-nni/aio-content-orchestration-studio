const fetch = require("node-fetch");

function decodeBody(buf) {
  // 1) Default to utf8
  let text = buf.toString("utf8");

  // 2) Heuristic fallback: if utf8 produced replacement chars, and it looks like
  //    a CP1252/latin1-encoded ® (0xAE) rather than UTF-8 ® (0xC2 0xAE),
  //    re-decode as latin1.
  if (text.includes("�")) {
    const hasSingleAE = buf.includes(0xae);
    const hasUtf8Reg = buf.includes(Buffer.from([0xc2, 0xae]));
    if (hasSingleAE && !hasUtf8Reg) {
      text = buf.toString("latin1");
    }
  }

  return text;
}

async function readResponseBuffer(res) {
  if (typeof res.buffer === "function") {
    // node-fetch v2
    return await res.buffer();
  }
  if (typeof res.arrayBuffer === "function") {
    // node-fetch v3
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  // last-resort fallback (shouldn't happen in node-fetch)
  const text = await res.text();
  return Buffer.from(text, "utf8");
}

/**
 * Fetch wrapper that returns parsed JSON (or null).
 * Throws with rich error info when response is not OK.
 */
async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);

  const buf = await readResponseBuffer(res);
  const text = decodeBody(buf);

  // Probe A (optional; temporarily)
  // console.log("[ENC]", { hasReg: text.includes("®"), hasReplacement: text.includes("�") });

  let data = null;
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

  return data;
}

module.exports = { fetchJson };