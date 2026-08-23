import encodeQR from '@paulmillr/qr'

// Port of desktop/ui/qr.js — same @paulmillr/qr call, same output shape (a
// plain '<svg ...>...</svg>' string) — plus one Android-only post-process.
//
// QA finding (Task 7, on-device): @paulmillr/qr's toSVG() emits one <rect>
// per dark module (1000+ for a typical invite string — confirmed via
// `node -e` on the real invite text). Desktop injects that string into an
// HTML DOM via dangerouslySetInnerHTML, where a browser renders thousands
// of <rect>s at no real cost. react-native-svg's SvgXml instead creates one
// native view per SVG element, so the same string became 1000+ native
// RectViews on Android — `adb logcat`'s EGL_emulation app_time_stats showed
// per-frame times up to ~24s while the invite QR was on screen, and the
// rest of the Devices tab (including the nav bar) was unresponsive to
// touch for that whole window. Merging every module into a single <path>
// (one 'M x y h1v1h-1z' subpath per dark module, same fill-black default)
// is visually identical but collapses that to one native view. Desktop's
// qr.js is untouched — this divergence is Android-only.
export function qrSvg (text) {
  return mergeRectsIntoPath(encodeQR(text, 'svg'))
}

const RECT_RE = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="1" height="1" \/>/g

function mergeRectsIntoPath (svg) {
  const d = [...svg.matchAll(RECT_RE)].map(([, x, y]) => `M${x} ${y}h1v1h-1z`).join('')
  return svg.replace(RECT_RE, '').replace('</svg>', `<path d="${d}" /></svg>`)
}
