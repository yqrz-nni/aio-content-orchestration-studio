// File: src/dx-excshell-1/actions/ajo/template/render/miniAjoRuntime.js
//
// This will evolve into a minimal evaluator for AJO-style handlebars blocks
// (starting with {{#each}} and later {{#if}} etc).
//
// For now: no-op passthrough to keep current behavior unchanged.

function renderMiniAjo(htmlSegment, _ctx) {
  return htmlSegment;
}

module.exports = { renderMiniAjo };