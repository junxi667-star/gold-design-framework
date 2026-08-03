const MASK_64 = (1n << 64n) - 1n;
const RATE_BYTES = 136;

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n,
  0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn,
  0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n,
  0x0000000080000001n, 0x8000000080008008n,
];

const ROTATION_OFFSETS = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotateLeft64(value, offset) {
  const shift = BigInt(offset % 64);
  if (shift === 0n) return value & MASK_64;
  return ((value << shift) | (value >> (64n - shift))) & MASK_64;
}

function readLaneLE(bytes, offset) {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(bytes[offset + index] ?? 0) << BigInt(index * 8);
  }
  return value;
}

function writeLaneLE(value, output, offset, maximum) {
  for (let index = 0; index < 8 && offset + index < maximum; index += 1) {
    output[offset + index] = Number((value >> BigInt(index * 8)) & 0xffn);
  }
}

function keccakF1600(state) {
  const c = new Array(5).fill(0n);
  const d = new Array(5).fill(0n);
  const b = new Array(25).fill(0n);

  for (const roundConstant of ROUND_CONSTANTS) {
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5] ^ rotateLeft64(c[(x + 1) % 5], 1);
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const index = x + 5 * y;
        state[index] = (state[index] ^ d[x]) & MASK_64;
      }
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const sourceIndex = x + 5 * y;
        const destinationX = y;
        const destinationY = (2 * x + 3 * y) % 5;
        b[destinationX + 5 * destinationY] = rotateLeft64(
          state[sourceIndex],
          ROTATION_OFFSETS[sourceIndex],
        );
      }
    }

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const index = x + 5 * y;
        state[index] = (
          b[index]
          ^ ((~b[((x + 1) % 5) + 5 * y]) & b[((x + 2) % 5) + 5 * y])
        ) & MASK_64;
      }
    }

    state[0] = (state[0] ^ roundConstant) & MASK_64;
  }
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new TypeError("keccak256 accepts a string, Buffer, or Uint8Array");
}

export function keccak256Bytes(value) {
  const input = toBytes(value);
  const paddingLength = RATE_BYTES - (input.length % RATE_BYTES);
  const padded = new Uint8Array(input.length + paddingLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      state[lane] ^= readLaneLE(padded, offset + lane * 8);
    }
    keccakF1600(state);
  }

  const output = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane += 1) {
    writeLaneLE(state[lane], output, lane * 8, output.length);
  }
  return output;
}

export function bytesToHex(bytes, prefix = true) {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return prefix ? `0x${hex}` : hex;
}

export function hexToBytes(hex) {
  const normalized = String(hex || "").replace(/^0x/i, "");
  if (!normalized || normalized.length % 2 || !/^[0-9a-f]+$/i.test(normalized)) {
    throw new TypeError("Invalid hex string");
  }
  const output = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

export function keccak256(value) {
  return bytesToHex(keccak256Bytes(value));
}

export function functionSelector(signature) {
  return bytesToHex(keccak256Bytes(signature).slice(0, 4));
}
