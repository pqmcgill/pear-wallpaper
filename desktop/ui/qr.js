import encodeQR from '@paulmillr/qr'

// @paulmillr/qr's default export is encodeQR(text, output, opts). Passing
// output='svg' calls the internal Bitmap#toSVG() and returns a plain
// '<svg ...>...</svg>' string directly — no further conversion needed.
export function qrSvg (text) {
  return encodeQR(text, 'svg')
}
