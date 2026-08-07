// KGM/KGMA decoder using Emscripten WASM runtime (a3-runtime.js)
let wasmPromise = null;
const CHUNK_SIZE = 2 * 1024 * 1024;
const MIN_HEADER_SIZE = 0x2c;

function loadWasm() {
  if (wasmPromise) return wasmPromise;
  if (typeof window.__KGM_A3 !== 'function') {
    return Promise.reject(new Error('Emscripten runtime (a3-runtime.js) not loaded'));
  }
  const factory = window.__KGM_A3();
  wasmPromise = factory().then(function(mod) {
    if (typeof mod.preDec !== 'function' || typeof mod.decBlob !== 'function') {
      throw new Error('WASM decryption functions not available');
    }
    return mod;
  }).catch(function(error) {
    wasmPromise = null;
    throw error;
  });
  return wasmPromise;
}

async function decryptWasm(fileData, extension) {
  const mod = await loadWasm();
  const data = new Uint8Array(fileData);
  if (data.length < MIN_HEADER_SIZE) {
    throw new Error('文件过短，不是有效的 KGM/KGMA 文件');
  }
  const buf = mod._malloc(CHUNK_SIZE);
  if (!buf) throw new Error('malloc failed');
  try {
    const headerLen = Math.min(CHUNK_SIZE, data.length);
    mod.HEAPU8.set(data.subarray(0, headerLen), buf);
    const consumed = mod.preDec(buf, headerLen, extension);
    if (!Number.isInteger(consumed) || consumed < MIN_HEADER_SIZE || consumed > data.length) {
      throw new Error('无效的加密文件头（consumed=' + consumed + '）');
    }
    const body = data.subarray(consumed);
    const out = new Uint8Array(body.length);
    let offset = 0;
    while (offset < body.length) {
      const sz = Math.min(CHUNK_SIZE, body.length - offset);
      mod.HEAPU8.set(body.subarray(offset, offset + sz), buf);
      // decBlob decrypts in place. offset is relative to the encrypted body.
      mod.decBlob(buf, sz, offset);
      out.set(mod.HEAPU8.subarray(buf, buf + sz), offset);
      offset += sz;
    }
    if (out.length !== data.length - consumed) {
      throw new Error('解密输出不完整');
    }
    return out;
  } finally {
    try { mod._free(buf); } catch(e) {}
  }
}

function detectEncryptionLayer(filename) {
  const match = String(filename).match(/\.(kgma|kgm)(?:\.(?:flac|mp3))?$/i);
  return match ? match[1].toLowerCase() : null;
}

function isMp3(filename) { return /\.mp3$/i.test(filename); }
function isFlac(filename) { return /\.flac$/i.test(filename); }
function getOutputFilename(filename, outputFormat) {
  const layer = detectEncryptionLayer(filename);
  if (layer && outputFormat) {
    return filename.replace(new RegExp('\\.' + layer + '(?:\\.(?:flac|mp3))?$', 'i'), '.' + outputFormat);
  }
  return filename;
}

// ── Output format detection (mirrors original Dn function) ─────────────
// Magic bytes for common audio formats (without length prefix)
const MAGICS = {
  mp3:  [0x49, 0x44, 0x33],                     // "ID3"
  flac: [0x66, 0x4C, 0x61, 0x43],               // "fLaC"
  ogg:  [0x4F, 0x67, 0x67, 0x53],               // "OggS"
  wav:  [0x52, 0x49, 0x46, 0x46],               // "RIFF"
  m4a:  null,                                    // "ftyp" at offset 4
  wma:  [0x30, 0x26, 0xB2, 0x75, 0x9E, 0x66, 0xCF, 0x11, 0xA6, 0xD9, 0x00, 0xAA, 0x00, 0x62, 0xCE, 0x6C],
  aac:  [0xFF, 0xF1],
  dff:  [0x46, 0x52, 0x4D, 0x38],               // "FRM8"
  ape:  [0x4D, 0x41, 0x43, 0x20],               // "MAC "
};
const MIME = {
  mp3:  'audio/mpeg',
  flac: 'audio/flac',
  ogg:  'audio/ogg',
  m4a:  'audio/mp4',
  wav:  'audio/x-wav',
  wma:  'audio/x-ms-wma',
  aac:  'audio/aac',
  dff:  'audio/x-dff',
  ape:  'audio/ape',
};

function checkMagic(data, magic) {
  if (data.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (data[i] !== magic[i]) return false;
  }
  return true;
}

function detectFormat(data) {
  if (checkMagic(data, MAGICS.mp3)) return 'mp3';
  // MP3 without an ID3 tag starts directly with an MPEG audio frame.
  if (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe6) === 0xe2) return 'mp3';
  if (checkMagic(data, MAGICS.flac)) return 'flac';
  if (checkMagic(data, MAGICS.ogg)) return 'ogg';
  // m4a: "ftyp" at offset 4
  if (data.length >= 4 + 4 && checkMagic(data.subarray(4), [0x66, 0x74, 0x79, 0x70])) return 'm4a';
  if (checkMagic(data, MAGICS.wav)) return 'wav';
  if (checkMagic(data, MAGICS.wma)) return 'wma';
  if (checkMagic(data, MAGICS.aac)) return 'aac';
  if (checkMagic(data, MAGICS.dff)) return 'dff';
  if (checkMagic(data, MAGICS.ape)) return 'ape';
  return null;
}

function getOutputMimeType(decryptedData) {
  const fmt = detectFormat(decryptedData);
  return MIME[fmt] || 'application/octet-stream';
}

window.__KGM = {
  decrypt: decryptWasm,
  detectEncryptionLayer,
  isMp3,
  isFlac,
  getOutputFilename,
  loadWasm,
  detectFormat,
  getOutputMimeType,
};
console.log('KGM decoder (Emscripten runtime) loaded');
