const b4a = require('b4a')

const MAX_BYTES = 20 * 1024 * 1024

// Format sniff + size cap only. Full decode verification is the OS
// setter's job (spec §6): a setter failure keeps the send queued.
// The messages are shown to the user as-is, by every shell.
function validateImage(buffer) {
  if (buffer.byteLength > MAX_BYTES) throw new Error('This picture is too big to send. Pick one under 20 MB.')
  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer.byteLength >= 8 && b4a.equals(buffer.subarray(0, 8), b4a.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
  if (buffer.byteLength >= 12 && b4a.toString(buffer.subarray(0, 4)) === 'RIFF' && b4a.toString(buffer.subarray(8, 12)) === 'WEBP') return '.webp'
  throw new Error('Only JPEG, PNG and WebP pictures can be sent. If this is an iPhone photo (HEIC), export it as a JPEG first.')
}

module.exports = { validateImage, MAX_BYTES }
