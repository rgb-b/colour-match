/**
 * Calibration patch set — CMYK only.
 * O/G channels excluded: they are used as extended-gamut inks for spot colour
 * reproduction, not as independent calibration variables.
 * Single-channel ramps, two-channel CMY combos, three-channel CMY mixes,
 * CMY+K combinations, neutral/rich-black ramp, and common spot territories.
 */

function patch(c, m, y, k) {
  return { c, m, y, k, o: 0, g: 0 }
}

const patches = [
  // ── Single channel ramps ─────────────────────────────────────────────────
  // Cyan
  patch(10,0,0,0), patch(25,0,0,0), patch(50,0,0,0),
  patch(75,0,0,0), patch(100,0,0,0),
  // Magenta
  patch(0,10,0,0), patch(0,25,0,0), patch(0,50,0,0),
  patch(0,75,0,0), patch(0,100,0,0),
  // Yellow
  patch(0,0,10,0), patch(0,0,25,0), patch(0,0,50,0),
  patch(0,0,75,0), patch(0,0,100,0),
  // Black
  patch(0,0,0,10), patch(0,0,0,25), patch(0,0,0,50),
  patch(0,0,0,75), patch(0,0,0,100),

  // ── Two-channel CMY ──────────────────────────────────────────────────────
  patch(25,25,0,0), patch(50,50,0,0), patch(75,75,0,0),
  patch(25,0,25,0), patch(50,0,50,0), patch(75,0,75,0),
  patch(0,25,25,0), patch(0,50,50,0), patch(0,75,75,0),

  // ── CMY + Black ──────────────────────────────────────────────────────────
  patch(25,0,0,25), patch(50,0,0,25), patch(75,0,0,25),
  patch(0,25,0,25), patch(0,50,0,25), patch(0,75,0,25),
  patch(0,0,25,25), patch(0,0,50,25), patch(0,0,75,25),

  // ── Three-channel CMY ────────────────────────────────────────────────────
  patch(25,25,25,0), patch(50,50,50,0), patch(75,75,75,0),
  patch(75,25,25,0), patch(25,75,25,0), patch(25,25,75,0),
  patch(75,75,25,0), patch(75,25,75,0), patch(25,75,75,0),
  patch(50,75,25,0), patch(25,50,75,0), patch(75,50,25,0),

  // ── CMY + K ──────────────────────────────────────────────────────────────
  patch(50,50,50,25), patch(50,50,50,50),
  patch(75,25,50,25), patch(25,75,50,25),
  patch(50,50,0,50),  patch(0,50,50,50),

  // ── Neutral / rich-black ramp ────────────────────────────────────────────
  patch(25,25,25,25), patch(50,50,50,50),
  patch(10,10,10,50), patch(0,0,0,0),   // paper white included for reference

  // ── Common spot-colour territories ───────────────────────────────────────
  patch(0,100,100,0),   // red
  patch(100,0,100,0),   // blue/purple
  patch(100,100,0,0),   // blue
  patch(0,100,0,0),     // pure magenta
  patch(0,0,100,0),     // pure yellow
  patch(100,0,0,0),     // pure cyan
]

// Assign sequential IDs
export default patches.map((p, i) => ({ id: i + 1, ...p }))
