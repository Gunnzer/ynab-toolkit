// Reading the text out of a PDF statement, in the browser, with no outside
// code (at explicit user request, chosen over bundling pdf.js). It covers
// what bank statements are made of: plain and Flate-compressed streams,
// object streams, fonts with a ToUnicode map or a standard encoding, form
// XObjects, and the text-positioning operators, so each piece of text keeps
// its place on the page and lines and columns can be rebuilt. It does not
// decrypt a locked PDF or read a scanned image (there is no text in one).
//
//   extractPdfText(bytes) -> { encrypted, pages: [{ lines: [line] }] }
//   line: { y, text, items: [{ x, x2, text }] }  (items are runs of text
//   separated by a wide gap, which is how columns show up)

// ---------- bytes and inflating ----------

function toLatin1(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return out;
}

function fromLatin1(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

// A truncated or slightly damaged stream still gives back what it decoded
// before the error, which is usually the whole text.
async function inflate(bytes, format = "deflate") {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
    }
  } catch {
    if (!total && format === "deflate" && bytes.length > 2) return inflate(bytes.subarray(2), "deflate-raw");
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function ascii85(bytes) {
  const text = toLatin1(bytes).replace(/\s+/g, "").replace(/^<~/, "").replace(/~>.*$/, "");
  const out = [];
  let group = [];
  for (const ch of text) {
    if (ch === "z" && !group.length) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      let value = 0;
      for (const digit of group) value = value * 85 + digit;
      out.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
      group = [];
    }
  }
  if (group.length) {
    const size = group.length;
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const last = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...last.slice(0, size - 1));
  }
  return new Uint8Array(out);
}

function asciiHex(bytes) {
  const text = toLatin1(bytes).replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.ceil(text.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt((text.slice(i * 2, i * 2 + 2) + "0").slice(0, 2), 16);
  return out;
}

// PNG predictors, which some object streams carry in DecodeParms.
function unpredict(bytes, parms) {
  const predictor = Number(parms?.Predictor) || 1;
  if (predictor < 10) return bytes;
  const columns = Number(parms.Columns) || 1;
  const colors = Number(parms.Colors) || 1;
  const bpc = Number(parms.BitsPerComponent) || 8;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLength = Math.ceil((columns * colors * bpc) / 8);
  const rows = Math.floor(bytes.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let previous = new Uint8Array(rowLength);
  for (let r = 0; r < rows; r += 1) {
    const type = bytes[r * (rowLength + 1)];
    const row = bytes.subarray(r * (rowLength + 1) + 1, (r + 1) * (rowLength + 1));
    const current = new Uint8Array(rowLength);
    for (let i = 0; i < rowLength; i += 1) {
      const left = i >= bpp ? current[i - bpp] : 0;
      const up = previous[i];
      const upLeft = i >= bpp ? previous[i - bpp] : 0;
      let value = row[i];
      if (type === 1) value += left;
      else if (type === 2) value += up;
      else if (type === 3) value += Math.floor((left + up) / 2);
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      current[i] = value & 255;
    }
    out.set(current, r * rowLength);
    previous = current;
  }
  return out;
}

// ---------- the PDF object syntax ----------
//
// Names are kept as "/Name" strings, PDF strings as { str } (raw bytes as a
// latin1 string), references as { ref }, dictionaries as plain objects keyed
// by name without the slash, and operators (in content streams) as { op }.

const WHITE = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)));

class Lexer {
  constructor(text, pos = 0) {
    this.s = text;
    this.pos = pos;
  }

  skip() {
    const s = this.s;
    for (;;) {
      while (this.pos < s.length && WHITE.has(s.charCodeAt(this.pos))) this.pos += 1;
      if (s[this.pos] !== "%") return;
      while (this.pos < s.length && s[this.pos] !== "\n" && s[this.pos] !== "\r") this.pos += 1;
    }
  }

  // One token: a number, name, string, keyword, or one of [ ] << >> { }.
  token() {
    this.skip();
    const s = this.s;
    if (this.pos >= s.length) return null;
    const c = s[this.pos];
    if (c === "[" || c === "]" || c === "{" || c === "}") {
      this.pos += 1;
      return { punct: c };
    }
    if (c === "<") {
      if (s[this.pos + 1] === "<") {
        this.pos += 2;
        return { punct: "<<" };
      }
      return this.hexString();
    }
    if (c === ">") {
      this.pos += s[this.pos + 1] === ">" ? 2 : 1;
      return { punct: ">>" };
    }
    if (c === "(") return this.literalString();
    if (c === "/") return this.name();
    if (c === ")") {
      this.pos += 1;
      return this.token();
    }
    const start = this.pos;
    while (this.pos < s.length && !WHITE.has(s.charCodeAt(this.pos)) && !DELIM.has(s.charCodeAt(this.pos))) this.pos += 1;
    const word = s.slice(start, this.pos);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (/^[+-]?\d*\.\d*\.\d*$/.test(word)) return Number.parseFloat(word) || 0;
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return { op: word };
  }

  name() {
    const s = this.s;
    this.pos += 1;
    const start = this.pos;
    while (this.pos < s.length && !WHITE.has(s.charCodeAt(this.pos)) && !DELIM.has(s.charCodeAt(this.pos))) this.pos += 1;
    return `/${s.slice(start, this.pos).replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))}`;
  }

  hexString() {
    const end = this.s.indexOf(">", this.pos);
    const body = this.s.slice(this.pos + 1, end < 0 ? this.s.length : end).replace(/[^0-9a-fA-F]/g, "");
    this.pos = end < 0 ? this.s.length : end + 1;
    let out = "";
    for (let i = 0; i < body.length; i += 2) out += String.fromCharCode(parseInt((body.slice(i, i + 2) + "0").slice(0, 2), 16));
    return { str: out };
  }

  literalString() {
    const s = this.s;
    let depth = 1;
    let out = "";
    this.pos += 1;
    while (this.pos < s.length) {
      const c = s[this.pos];
      if (c === "\\") {
        const n = s[this.pos + 1];
        this.pos += 2;
        if (n === "n") out += "\n";
        else if (n === "r") out += "\r";
        else if (n === "t") out += "\t";
        else if (n === "b") out += "\b";
        else if (n === "f") out += "\f";
        else if (n === "\r") {
          if (s[this.pos] === "\n") this.pos += 1;
        } else if (n === "\n") {
          // line continuation
        } else if (n >= "0" && n <= "7") {
          let digits = n;
          while (digits.length < 3 && s[this.pos] >= "0" && s[this.pos] <= "7") {
            digits += s[this.pos];
            this.pos += 1;
          }
          out += String.fromCharCode(parseInt(digits, 8) & 0xff);
        } else if (n !== undefined) out += n;
        continue;
      }
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (!depth) {
          this.pos += 1;
          break;
        }
      }
      out += c;
      this.pos += 1;
    }
    return { str: out };
  }

  // A whole value: arrays and dictionaries nested, "12 0 R" as a reference.
  value(first = this.token()) {
    const tok = first;
    if (tok && typeof tok === "object" && "punct" in tok) {
      if (tok.punct === "[") {
        const list = [];
        for (;;) {
          const next = this.token();
          if (next === null || next?.punct === "]") break;
          list.push(this.value(next));
        }
        return list;
      }
      if (tok.punct === "<<") {
        const dict = {};
        for (;;) {
          const key = this.token();
          if (key === null || key?.punct === ">>") break;
          if (typeof key !== "string") continue;
          dict[key.slice(1)] = this.value();
        }
        return dict;
      }
      return tok;
    }
    if (typeof tok === "number" && Number.isInteger(tok) && tok >= 0) {
      const save = this.pos;
      const gen = this.token();
      if (typeof gen === "number" && Number.isInteger(gen)) {
        const r = this.token();
        if (r?.op === "R") return { ref: tok, gen };
      }
      this.pos = save;
    }
    return tok;
  }
}

// ---------- the document ----------

class PdfDocument {
  constructor(bytes) {
    this.bytes = bytes;
    this.s = toLatin1(bytes);
    this.offsets = new Map();
    this.cache = new Map();
    this.streamCache = new Map();
    this.compressed = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let match;
    while ((match = re.exec(this.s))) this.offsets.set(Number(match[1]), match.index + match[0].length);
  }

  get encrypted() {
    return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(this.s);
  }

  // Objects packed inside object streams (PDF 1.5 and later).
  async loadObjectStreams() {
    for (const num of [...this.offsets.keys()]) {
      const obj = this.parseAt(num);
      if (!obj?.dict || obj.dict.Type !== "/ObjStm") continue;
      const data = toLatin1(await this.streamData(obj));
      const first = Number(obj.dict.First) || 0;
      const lexer = new Lexer(data.slice(0, first));
      const n = Number(obj.dict.N) || 0;
      for (let i = 0; i < n; i += 1) {
        const objNum = lexer.token();
        const offset = lexer.token();
        if (typeof objNum !== "number" || typeof offset !== "number") break;
        if (!this.offsets.has(objNum) && !this.compressed.has(objNum)) {
          this.compressed.set(objNum, new Lexer(data, first + offset).value());
        }
      }
    }
  }

  parseAt(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    const offset = this.offsets.get(num);
    if (offset === undefined) return this.compressed.has(num) ? this.compressed.get(num) : null;
    const lexer = new Lexer(this.s, offset);
    const value = lexer.value();
    let result = value;
    const save = lexer.pos;
    const next = lexer.token();
    if (next?.op === "stream" && value && typeof value === "object" && !Array.isArray(value)) {
      let start = lexer.pos;
      if (this.s[start] === "\r") start += 1;
      if (this.s[start] === "\n") start += 1;
      result = { dict: value, start };
    } else lexer.pos = save;
    this.cache.set(num, result);
    return result;
  }

  get(value) {
    let seen = 0;
    while (value && typeof value === "object" && "ref" in value && seen < 20) {
      value = this.parseAt(value.ref);
      seen += 1;
    }
    return value;
  }

  // A stream object's dictionary.
  dictOf(value) {
    const obj = this.get(value);
    return obj?.dict || obj;
  }

  rawStream(obj) {
    let length = this.get(obj.dict.Length);
    const s = this.s;
    if (typeof length !== "number" || s.slice(obj.start + length, obj.start + length + 30).indexOf("endstream") < 0) {
      const end = s.indexOf("endstream", obj.start);
      length = (end < 0 ? s.length : end) - obj.start;
      while (length > 0 && (s[obj.start + length - 1] === "\n" || s[obj.start + length - 1] === "\r")) length -= 1;
    }
    return this.bytes.subarray(obj.start, obj.start + length);
  }

  async streamData(value) {
    const obj = this.get(value);
    if (!obj?.dict) return new Uint8Array(0);
    if (this.streamCache.has(obj)) return this.streamCache.get(obj);
    let data = this.rawStream(obj);
    const filters = [].concat(this.get(obj.dict.Filter) || []);
    const parms = [].concat(this.get(obj.dict.DecodeParms) || []);
    for (let i = 0; i < filters.length; i += 1) {
      const filter = filters[i];
      if (filter === "/FlateDecode" || filter === "/Fl") data = unpredict(await inflate(data), this.get(parms[i]));
      else if (filter === "/ASCII85Decode" || filter === "/A85") data = ascii85(data);
      else if (filter === "/ASCIIHexDecode" || filter === "/AHx") data = asciiHex(data);
      else {
        data = new Uint8Array(0);
        break;
      }
    }
    this.streamCache.set(obj, data);
    return data;
  }

  // Pages in reading order, each with its inherited Resources.
  pages() {
    let catalog = null;
    const trailer = this.s.lastIndexOf("trailer");
    if (trailer >= 0) {
      const dict = new Lexer(this.s, trailer + 7).value();
      catalog = this.dictOf(dict?.Root);
    }
    if (!catalog?.Pages) {
      for (const num of [...this.offsets.keys(), ...this.compressed.keys()]) {
        const dict = this.dictOf({ ref: num });
        if (dict?.Type === "/Catalog") catalog = dict;
        if (dict?.Type === "/XRef" && dict.Root) catalog = this.dictOf(dict.Root);
        if (catalog?.Pages) break;
      }
    }
    const out = [];
    const walk = (node, inherited, depth) => {
      const dict = this.dictOf(node);
      if (!dict || depth > 50) return;
      const resources = dict.Resources !== undefined ? dict.Resources : inherited;
      if (dict.Type === "/Pages" || Array.isArray(this.get(dict.Kids))) {
        for (const kid of this.get(dict.Kids) || []) walk(kid, resources, depth + 1);
      } else out.push({ dict, resources: this.dictOf(resources) || {} });
    };
    if (catalog?.Pages) walk(catalog.Pages, null, 0);
    if (!out.length) {
      for (const num of this.offsets.keys()) {
        const dict = this.dictOf({ ref: num });
        if (dict?.Type === "/Page") out.push({ dict, resources: this.dictOf(dict.Resources) || {} });
      }
    }
    return out;
  }
}

// ---------- fonts ----------

const WIN_ANSI_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

function winAnsi(code) {
  if (code >= 0x80 && code <= 0x9f) return WIN_ANSI_HIGH[code - 0x80] ? String.fromCharCode(WIN_ANSI_HIGH[code - 0x80]) : "";
  return String.fromCharCode(code);
}

const GLYPHS = {
  space: " ", exclam: "!", quotedbl: "\"", numbersign: "#", dollar: "$", percent: "%", ampersand: "&",
  quotesingle: "'", quoteright: "'", quoteleft: "'", parenleft: "(", parenright: ")", asterisk: "*", plus: "+",
  comma: ",", hyphen: "-", minus: "-", period: ".", slash: "/", colon: ":", semicolon: ";", less: "<",
  equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]",
  asciicircum: "^", underscore: "_", grave: "`", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  endash: "-", emdash: "-", bullet: "*", quotedblleft: "\"", quotedblright: "\"", ellipsis: "...",
  nbspace: " ", sfthyphen: "-", degree: String.fromCharCode(0xb0), Euro: String.fromCharCode(0x20ac),
  eacute: String.fromCharCode(0xe9), egrave: String.fromCharCode(0xe8), ecircumflex: String.fromCharCode(0xea),
  edieresis: String.fromCharCode(0xeb), agrave: String.fromCharCode(0xe0), acircumflex: String.fromCharCode(0xe2),
  ccedilla: String.fromCharCode(0xe7), icircumflex: String.fromCharCode(0xee), idieresis: String.fromCharCode(0xef),
  ocircumflex: String.fromCharCode(0xf4), ucircumflex: String.fromCharCode(0xfb), ugrave: String.fromCharCode(0xf9),
  Eacute: String.fromCharCode(0xc9), Egrave: String.fromCharCode(0xc8), Agrave: String.fromCharCode(0xc0),
  Ccedilla: String.fromCharCode(0xc7),
};

function glyphText(name) {
  const bare = name.replace(/^\//, "").replace(/\..*$/, "");
  if (GLYPHS[bare] !== undefined) return GLYPHS[bare];
  if (/^[A-Za-z]$/.test(bare)) return bare;
  const uni = bare.match(/^uni([0-9A-Fa-f]{4,})$/) || bare.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (uni) return String.fromCodePoint(parseInt(uni[1].slice(0, 6), 16));
  return null;
}

function utf16(hexBytes) {
  let out = "";
  for (let i = 0; i + 1 < hexBytes.length; i += 2) out += String.fromCharCode((hexBytes.charCodeAt(i) << 8) | hexBytes.charCodeAt(i + 1));
  if (hexBytes.length % 2) out += String.fromCharCode(hexBytes.charCodeAt(hexBytes.length - 1));
  return out;
}

function bytesToInt(str) {
  let value = 0;
  for (let i = 0; i < str.length; i += 1) value = value * 256 + str.charCodeAt(i);
  return value;
}

/** A ToUnicode CMap: code -> text, and how many bytes a code takes. */
export function parseCMap(text) {
  const map = new Map();
  let codeBytes = 0;
  const lexer = new Lexer(text);
  let section = null;
  const pending = [];
  for (;;) {
    const tok = lexer.token();
    if (tok === null) break;
    if (tok?.op) {
      if (/^begin(codespacerange|bfchar|bfrange|cidchar|cidrange)$/.test(tok.op)) {
        section = tok.op.slice(5);
        pending.length = 0;
      } else if (tok.op.startsWith("end")) section = null;
      continue;
    }
    if (!section) continue;
    const value = tok?.punct === "[" ? lexer.value(tok) : tok;
    pending.push(value);
    if (section === "codespacerange" && pending.length === 2) {
      codeBytes = Math.max(codeBytes, pending[0]?.str?.length || 0);
      pending.length = 0;
    } else if (section === "bfchar" && pending.length === 2) {
      if (pending[0]?.str !== undefined && pending[1]?.str !== undefined) {
        map.set(bytesToInt(pending[0].str), utf16(pending[1].str));
        codeBytes = codeBytes || pending[0].str.length;
      }
      pending.length = 0;
    } else if (section === "bfrange" && pending.length === 3) {
      const [lo, hi, dst] = pending;
      if (lo?.str !== undefined && hi?.str !== undefined) {
        const from = bytesToInt(lo.str);
        const to = bytesToInt(hi.str);
        codeBytes = codeBytes || lo.str.length;
        for (let code = from; code <= to && code - from < 65536; code += 1) {
          if (Array.isArray(dst)) {
            if (dst[code - from]?.str !== undefined) map.set(code, utf16(dst[code - from].str));
          } else if (dst?.str !== undefined) {
            // The range's first target, with its last UTF-16 unit counted up.
            const units = [...utf16(dst.str)].map((c) => c.charCodeAt(0));
            if (units.length) units[units.length - 1] += code - from;
            map.set(code, String.fromCharCode(...units));
          }
        }
      }
      pending.length = 0;
    } else if ((section === "cidchar" && pending.length === 2) || (section === "cidrange" && pending.length === 3)) {
      pending.length = 0;
    }
  }
  return { map, codeBytes: codeBytes || 1 };
}

async function loadFont(doc, ref) {
  const font = doc.dictOf(ref) || {};
  const subtype = font.Subtype;
  const composite = subtype === "/Type0";
  const descendant = composite ? doc.dictOf((doc.get(font.DescendantFonts) || [])[0]) || {} : null;
  let toUnicode = null;
  if (font.ToUnicode) {
    const obj = doc.get(font.ToUnicode);
    if (obj?.dict) toUnicode = parseCMap(toLatin1(await doc.streamData(obj)));
  }
  const codeBytes = composite ? 2 : (toUnicode?.codeBytes === 2 ? 2 : 1);

  // Widths in thousandths of the font size.
  const widths = new Map();
  let defaultWidth = composite ? Number(doc.get(descendant.DW)) || 1000 : 500;
  if (composite) {
    const w = doc.get(descendant.W) || [];
    for (let i = 0; i < w.length;) {
      const first = doc.get(w[i]);
      const next = doc.get(w[i + 1]);
      if (Array.isArray(next)) {
        next.forEach((width, k) => widths.set(first + k, doc.get(width)));
        i += 2;
      } else {
        const width = doc.get(w[i + 2]);
        for (let code = first; code <= next && code - first < 65536; code += 1) widths.set(code, width);
        i += 3;
      }
    }
  } else {
    const firstChar = Number(doc.get(font.FirstChar)) || 0;
    const list = doc.get(font.Widths) || [];
    const scale = subtype === "/Type3" ? (Number((doc.get(font.FontMatrix) || [0.001])[0]) || 0.001) * 1000 : 1;
    list.forEach((width, k) => widths.set(firstChar + k, (Number(doc.get(width)) || 0) * scale));
    const desc = doc.dictOf(font.FontDescriptor);
    if (desc?.MissingWidth) defaultWidth = Number(doc.get(desc.MissingWidth)) || defaultWidth;
  }

  // Simple fonts without a ToUnicode map: a standard encoding plus any
  // /Differences glyph names.
  const differences = new Map();
  let encoding = doc.get(font.Encoding);
  if (encoding && typeof encoding === "object") {
    const diff = doc.get(encoding.Differences) || [];
    let code = 0;
    for (const entry of diff) {
      const value = doc.get(entry);
      if (typeof value === "number") code = value;
      else if (typeof value === "string") {
        differences.set(code, value);
        code += 1;
      }
    }
    encoding = encoding.BaseEncoding;
  }

  return {
    decode(raw) {
      const out = [];
      for (let i = 0; i < raw.length; i += codeBytes) {
        const code = codeBytes === 2 ? (raw.charCodeAt(i) << 8) | (raw.charCodeAt(i + 1) || 0) : raw.charCodeAt(i);
        let text = toUnicode?.map.get(code);
        if (text === undefined && !composite) {
          const name = differences.get(code);
          text = name ? glyphText(name) : null;
          if (text === null || text === undefined) text = encoding === "/MacRomanEncoding" && code > 127 ? "" : winAnsi(code);
        }
        if (text === undefined) text = "";
        const width = widths.has(code) ? widths.get(code) : (code === 32 ? 278 : defaultWidth);
        out.push({ code, text, width, space: codeBytes === 1 && code === 32 });
      }
      return out;
    },
  };
}

// ---------- reading a page's content ----------

const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

async function readContent(doc, data, resources, ctm, items, fonts, depth = 0) {
  const lexer = new Lexer(data);
  const operands = [];
  let state = { ctm, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  const stack = [];
  let tm = IDENTITY;
  let tlm = IDENTITY;
  const fontDict = doc.dictOf(resources?.Font) || {};
  const xobjects = doc.dictOf(resources?.XObject) || {};

  async function fontFor(name) {
    const ref = fontDict[name.slice(1)];
    if (!ref) return null;
    const key = ref.ref !== undefined ? `r${ref.ref}` : `${depth}:${name}`;
    if (!fonts.has(key)) fonts.set(key, await loadFont(doc, ref));
    return fonts.get(key);
  }

  const moveText = (tx, ty) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  const show = (raw) => {
    const font = state.font;
    if (!font || typeof raw !== "string") return;
    const glyphs = font.decode(raw);
    const m = multiply(tm, state.ctm);
    const scaleY = Math.hypot(m[2], m[3]) || 1;
    // Sideways text (a margin note, a barcode caption) is not a statement line.
    const sideways = Math.abs(m[1]) > Math.abs(m[0]) + 0.01;
    let advance = 0;
    let text = "";
    for (const glyph of glyphs) {
      text += glyph.text;
      advance += ((glyph.width / 1000) * state.size + state.tc + (glyph.space ? state.tw : 0)) * state.th;
    }
    if (!sideways && text) {
      const x = m[4] + state.rise * m[2];
      const y = m[5] + state.rise * m[3];
      const end = multiply([1, 0, 0, 1, advance, 0], m);
      items.push({ x, y, x2: end[4], text, size: state.size * scaleY });
    }
    tm = multiply([1, 0, 0, 1, advance, 0], tm);
  };

  for (;;) {
    const tok = lexer.token();
    if (tok === null) break;
    if (!(tok && typeof tok === "object" && "op" in tok)) {
      operands.push(tok?.punct ? lexer.value(tok) : tok);
      continue;
    }
    const op = tok.op;
    const args = operands.splice(0);
    switch (op) {
      case "q": stack.push({ ...state }); break;
      case "Q": state = stack.pop() || state; break;
      case "cm": if (args.length === 6) state.ctm = multiply(args.map(Number), state.ctm); break;
      case "BT": tm = IDENTITY; tlm = IDENTITY; break;
      case "Tf":
        state.font = await fontFor(String(args[0]));
        state.size = Number(args[1]) || 0;
        break;
      case "Tc": state.tc = Number(args[0]) || 0; break;
      case "Tw": state.tw = Number(args[0]) || 0; break;
      case "Tz": state.th = (Number(args[0]) || 100) / 100; break;
      case "TL": state.tl = Number(args[0]) || 0; break;
      case "Ts": state.rise = Number(args[0]) || 0; break;
      case "Td": moveText(Number(args[0]) || 0, Number(args[1]) || 0); break;
      case "TD":
        state.tl = -(Number(args[1]) || 0);
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case "Tm":
        if (args.length === 6) {
          tlm = args.map(Number);
          tm = tlm;
        }
        break;
      case "T*": moveText(0, -state.tl); break;
      case "Tj": show(args[0]?.str); break;
      case "'":
        moveText(0, -state.tl);
        show(args[0]?.str);
        break;
      case "\"":
        state.tw = Number(args[0]) || 0;
        state.tc = Number(args[1]) || 0;
        moveText(0, -state.tl);
        show(args[2]?.str);
        break;
      case "TJ":
        for (const part of Array.isArray(args[0]) ? args[0] : []) {
          if (part?.str !== undefined) show(part.str);
          else if (typeof part === "number") tm = multiply([1, 0, 0, 1, (-part / 1000) * state.size * state.th, 0], tm);
        }
        break;
      case "Do": {
        const xo = doc.get(xobjects[String(args[0]).slice(1)]);
        if (xo?.dict?.Subtype === "/Form" && depth < 8) {
          const matrix = (doc.get(xo.dict.Matrix) || IDENTITY).map(Number);
          await readContent(doc, toLatin1(await doc.streamData(xo)),
            doc.dictOf(xo.dict.Resources) || resources, multiply(matrix, state.ctm), items, fonts, depth + 1);
        }
        break;
      }
      case "BI": {
        // An inline image: its binary data could look like anything.
        const id = data.indexOf("ID", lexer.pos);
        const end = id < 0 ? -1 : data.slice(id + 2).search(/\sEI(\s|$)/);
        lexer.pos = end < 0 ? data.length : id + 2 + end + 3;
        break;
      }
      default: break;
    }
  }
}

// ---------- lines and columns ----------

/**
 * Pieces of text grouped into lines (by height on the page, top first) and,
 * within a line, into runs split wherever the gap is wide enough to be a
 * column break. A small gap becomes a space.
 */
export function groupLines(items) {
  const sorted = items.filter((i) => i.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    const tolerance = Math.max(2, item.size * 0.45);
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) line.pieces.push(item);
    else lines.push({ y: item.y, pieces: [item] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((line) => {
    const pieces = line.pieces.sort((a, b) => a.x - b.x);
    const runs = [];
    for (const piece of pieces) {
      const run = runs[runs.length - 1];
      const em = Math.max(piece.size, 1);
      const gap = run ? piece.x - run.x2 : Infinity;
      if (run && gap < em * 1.2) {
        const needsSpace = gap > em * 0.15 && !run.text.endsWith(" ") && !piece.text.startsWith(" ");
        run.text += (needsSpace ? " " : "") + piece.text;
        run.x2 = Math.max(run.x2, piece.x2);
      } else runs.push({ x: piece.x, x2: piece.x2, text: piece.text });
    }
    for (const run of runs) run.text = run.text.replace(/\s+/g, " ").trim();
    return {
      y: line.y,
      items: runs.filter((r) => r.text),
      text: runs.map((r) => r.text).filter(Boolean).join(" "),
    };
  });
}

/** All the text of a PDF, page by page, as positioned lines. */
export async function extractPdfText(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (toLatin1(data.subarray(0, 1024)).indexOf("%PDF") < 0) throw new Error("This is not a PDF file.");
  const doc = new PdfDocument(data);
  if (doc.encrypted) return { encrypted: true, pages: [] };
  await doc.loadObjectStreams();
  const fonts = new Map();
  const pages = [];
  for (const page of doc.pages()) {
    const contents = [].concat(doc.get(page.dict.Contents) || []);
    let text = "";
    for (const part of contents) text += `${toLatin1(await doc.streamData(part))}\n`;
    const items = [];
    await readContent(doc, text, page.resources, IDENTITY, items, fonts);
    pages.push({ lines: groupLines(items) });
  }
  return { encrypted: false, pages };
}

export const _test = { Lexer, toLatin1, fromLatin1, ascii85, asciiHex, unpredict, glyphText };
