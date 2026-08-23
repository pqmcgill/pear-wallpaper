import encodeQR from '@paulmillr/qr'
import { qrSvg } from '../lib/qr'

// Regression coverage for a real on-device perf bug found in Task 7 QA:
// @paulmillr/qr's toSVG() emits one <rect> per dark module (1000+ for a
// real invite string), and react-native-svg's SvgXml turns each SVG
// element into its own native view — 1000+ RectViews pegged the UI thread
// for seconds per frame on the emulator. lib/qr.js merges every module
// into a single <path> before handing the string to SvgXml.

test('qrSvg emits a single <path> and no <rect>s', () => {
  const svg = qrSvg('some-invite-string')
  expect(svg).not.toContain('<rect')
  expect((svg.match(/<path/g) || []).length).toBe(1)
})

test('the merged path visits the exact same module coordinates as the raw per-rect output', () => {
  const raw = encodeQR('some-invite-string', 'svg')
  const rectCoords = [...raw.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)"/g)]
    .map(([, x, y]) => `${x},${y}`)
    .sort()

  const svg = qrSvg('some-invite-string')
  const pathD = svg.match(/<path d="([^"]*)"/)[1]
  const pathCoords = [...pathD.matchAll(/M(-?[\d.]+) (-?[\d.]+)h1v1h-1z/g)]
    .map(([, x, y]) => `${x},${y}`)
    .sort()

  expect(pathCoords).toEqual(rectCoords)
  expect(pathCoords.length).toBeGreaterThan(0)
})

test('the viewBox (and everything else outside the modules) is preserved unchanged', () => {
  const raw = encodeQR('some-invite-string', 'svg')
  const svg = qrSvg('some-invite-string')
  expect(svg.match(/viewBox="[^"]*"/)[0]).toBe(raw.match(/viewBox="[^"]*"/)[0])
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
})
