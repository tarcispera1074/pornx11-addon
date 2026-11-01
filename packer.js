// Dean Edwards packer unpacker: eval(function(p,a,c,k,e,d){...}('payload',a,c,'k'.split('|'),...))
//
// This used to be done with `new Function(...)` in server.js, which evaluates
// remote page content inside the addon process. The unpacker only ever needs
// four literals, so it is parsed here with a regex instead. Unparseable input
// returns null — exactly like the old `catch {}` — but never executes anything.

const MARKER = "eval(function(p,a,c,k,e,d)";

// }('payload', a, c, 'word|word|word'.split('|') , ...)
const PACKED_ARGS =
  /}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\s*\.split\(\s*(['"])\|?\7\s*\)/;

const MAX_PAYLOAD = 2_000_000;
const MAX_WORDS = 50_000;

/** True when this script looks like a packed block (cheap check for callers). */
export function isPacked(scriptText) {
  return typeof scriptText === "string" && scriptText.includes(MARKER);
}

/**
 * Unpack a Dean Edwards packed block. Returns the payload with tokens replaced,
 * or null when the input is not the canonical form.
 * @param {string} scriptText
 * @returns {string | null}
 */
export function unpackDeanEdwards(scriptText) {
  if (!isPacked(scriptText)) return null;

  const start = scriptText.indexOf(MARKER);
  const sub = scriptText.slice(start);
  const m = PACKED_ARGS.exec(sub);
  if (!m) return null;

  const payload = m[2];
  const base = Number(m[3]);
  const count = Number(m[4]);
  const wordList = m[6];

  if (!Number.isInteger(base) || base < 2 || base > 36) return null;
  if (!Number.isInteger(count) || count < 0 || count > MAX_WORDS) return null;
  if (payload.length > MAX_PAYLOAD) return null;

  const words = wordList.split("|");
  let out = payload;

  // Same order as the original: highest index down to 0.
  for (let n = count - 1; n >= 0; n--) {
    const word = words[n];
    if (!word) continue;
    let token;
    try {
      token = n.toString(base);
    } catch {
      continue;
    }
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Function replacer so `$&`, `$1`, ... inside `word` stay literal.
    out = out.replace(new RegExp("\\b" + escaped + "\\b", "g"), () => word);
  }

  return out;
}
