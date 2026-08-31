// React Flight-protocol resolver for LinkedIn's SDUI component responses.
// The raw response is newline-delimited chunks: "N:<json-or-import>".
// Values inside those JSON chunks can be "$LN" strings, which mean "the
// real value here lives in chunk N" -- possibly several levels deep. This
// resolves every chunk, following those references recursively, so the
// data reads the same way it would after React actually rendered it.

function parseFlightStream(rawText) {
  const index = {};
  // chunks can contain embedded newlines inside JSON strings, so split on
  // a line-start pattern (hex id + colon) rather than blind '\n'.split
  const lines = rawText.split(/\n(?=[0-9a-fA-F]+:)/);
  for (const line of lines) {
    const m = line.match(/^([0-9a-fA-F]+):([\s\S]*)$/);
    if (!m) continue;
    index[m[1]] = m[2];
  }
  return index;
}

function parseLinePayload(raw) {
  if (raw.startsWith('I[')) {
    return { __import: true, raw }; // component import declaration, not data
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

function resolveAll(index) {
  const cache = {};

  function resolveValue(val) {
    if (typeof val === 'string') {
      const m = val.match(/^\$L([0-9a-fA-F]+)$/);
      if (m) return resolveId(m[1]);
      if (val === '$undefined') return undefined;
      return val;
    }
    if (Array.isArray(val)) return val.map(resolveValue);
    if (val && typeof val === 'object') {
      if (val.__import) return val;
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = resolveValue(v);
      return out;
    }
    return val;
  }

  function resolveId(id) {
    if (id in cache) return cache[id];
    cache[id] = undefined; // cycle guard
    const raw = index[id];
    if (raw === undefined) return undefined;
    const resolved = resolveValue(parseLinePayload(raw));
    cache[id] = resolved;
    return resolved;
  }

  const resolved = {};
  for (const id of Object.keys(index)) resolved[id] = resolveId(id);
  return resolved;
}

// Walk a resolved tree and collect every plain-string leaf, in document
// order, de-duping consecutive repeats (LinkedIn duplicates text for
// hidden a11y spans, same as we saw in the DOM approach).
function extractStrings(node, out = []) {
  if (typeof node === 'string') {
    const t = node.trim();
    if (t && !t.startsWith('$') && (out.length === 0 || out[out.length - 1] !== t)) {
      out.push(t);
    }
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) extractStrings(item, out);
    return out;
  }
  if (node && typeof node === 'object' && !node.__import) {
    for (const v of Object.values(node)) extractStrings(v, out);
  }
  return out;
}

module.exports = { parseFlightStream, resolveAll, extractStrings };
