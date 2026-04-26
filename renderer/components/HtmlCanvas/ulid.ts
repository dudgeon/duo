// Stage 17b — tiny ULID generator (PRD H12).
//
// 26-char Crockford base32. First 10 chars encode a 48-bit timestamp
// (millisecond-resolution, sortable by creation time). Last 16 chars
// are random (80 bits) — collision-safe at our scale (we mint maybe
// hundreds of IDs per file; collision probability is astronomical).
//
// Hand-rolled to avoid pulling in a dep for a 30-LOC need. The
// reference implementation (npm `ulid`) is ~150 LOC; this matches the
// shape but skips the monotonic-counter mode we don't need (we never
// mint two IDs in the same millisecond from the same context).

// Crockford base32: skips I, L, O, U to avoid letter/digit confusion.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ENCODING_LEN = 32
const TIME_LEN = 10
const RANDOM_LEN = 16

export function newULID(now: number = Date.now()): string {
  return encodeTime(now, TIME_LEN) + encodeRandom(RANDOM_LEN)
}

function encodeTime(ts: number, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i--) {
    const mod = ts % ENCODING_LEN
    out = ENCODING[mod] + out
    ts = (ts - mod) / ENCODING_LEN
  }
  return out
}

function encodeRandom(len: number): string {
  const buf = new Uint8Array(len)
  // crypto.getRandomValues is the same primitive node `ulid` uses.
  // Available in every Electron renderer + main process.
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += ENCODING[buf[i] % ENCODING_LEN]
  }
  return out
}
