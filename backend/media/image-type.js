const IMAGE_SIGNATURES = Object.freeze([
  {
    mimeType: "image/png",
    extension: ".png",
    matches: (bytes) => bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: "image/jpeg",
    extension: ".jpg",
    matches: (bytes) => bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff,
  },
  {
    mimeType: "image/webp",
    extension: ".webp",
    matches: (bytes) => bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP",
  },
]);

const MIME_ALIASES = Object.freeze({
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
});

export function normalizeImageMimeType(value) {
  const mimeType = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return MIME_ALIASES[mimeType] || mimeType;
}

export function detectImageType(bytes) {
  if (!Buffer.isBuffer(bytes)) return null;
  return IMAGE_SIGNATURES.find((signature) => signature.matches(bytes)) || null;
}
