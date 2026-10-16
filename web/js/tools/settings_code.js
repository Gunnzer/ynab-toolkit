// Settings as a short text code, for moving them between devices (phone and
// computer) without a file: share or copy it on one, paste it on the other.
// It carries exactly what a backup file does - never the access token.
//
// "YTK1." + base64url(gzip(JSON)); "YTK0." + base64url(JSON) where the
// browser cannot compress.

const PREFIX_GZIP = "YTK1.";
const PREFIX_PLAIN = "YTK0.";

function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

/** A backup object (store.exportData()) as a text code. */
export async function encodeSettings(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "function") {
    return PREFIX_GZIP + toBase64Url(await pipe(bytes, new CompressionStream("gzip")));
  }
  return PREFIX_PLAIN + toBase64Url(bytes);
}

/**
 * A text code back into a backup object. Whitespace anywhere (a messaging
 * app wrapping a long line) is ignored. Throws a plain-language error for
 * anything that is not one of these codes.
 */
export async function decodeSettings(code) {
  const text = String(code || "").replace(/\s+/g, "");
  let bytes;
  try {
    if (text.startsWith(PREFIX_GZIP)) {
      bytes = await pipe(fromBase64Url(text.slice(PREFIX_GZIP.length)), new DecompressionStream("gzip"));
    } else if (text.startsWith(PREFIX_PLAIN)) {
      bytes = fromBase64Url(text.slice(PREFIX_PLAIN.length));
    } else {
      throw new Error("prefix");
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("That is not a settings code from YNAB Toolkit, or part of it is missing.");
  }
}
