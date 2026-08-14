#!/usr/bin/env node
/**
 * Renders the demo output (assets/demo-output.txt) into a terminal-styled
 * SVG (assets/demo-cli.svg) for the README.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(root, 'assets')
mkdirSync(assets, { recursive: true })

const text = readFileSync(join(assets, 'demo-output.txt'), 'utf8').replace(/\r?\n$/u, '')
const lines = text.split('\n')

const esc = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Color a line by its content, terminal-style. */
function style(line) {
  if (/^Testgen (PASSED|FIXED)/u.test(line)) return '#3fb950' // green
  if (/^Testgen (FAILED|SKIPPED)/u.test(line)) return '#f85149' // red
  if (/^Run #\d+.*PASS/u.test(line)) return '#3fb950'
  if (/^Run #\d+.*FAIL/u.test(line)) return '#f85149'
  if (/^  wrote /u.test(line)) return '#58a6ff' // blue
  if (/^Targets /u.test(line)) return '#d2a8ff' // purple
  if (/^Warning:/u.test(line)) return '#d29922' // yellow
  if (/^  ✗/u.test(line)) return '#f85149'
  return '#c9d1d9' // default fg
}

const FONT_SIZE = 14
const LINE_HEIGHT = 21
const PAD_X = 20
const PAD_TOP = 52
const PAD_BOTTOM = 20
const width = 880
const height = PAD_TOP + lines.length * LINE_HEIGHT + PAD_BOTTOM

const textSpans = lines
  .map((line, index) => {
    const y = PAD_TOP + index * LINE_HEIGHT + LINE_HEIGHT * 0.75
    return `<text x="${PAD_X}" y="${y}" font-family="Consolas, 'Cascadia Mono', Menlo, monospace" font-size="${FONT_SIZE}" fill="${style(line)}">${esc(line) || ' '}</text>`
  })
  .join('\n')

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="dsh-testgen terminal demo">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#161b22"/>
      <stop offset="1" stop-color="#0d1117"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="12" fill="url(#bg)"/>
  <rect width="${width}" height="34" rx="12" fill="#21262d"/>
  <rect y="22" width="${width}" height="12" fill="#21262d"/>
  <circle cx="30" cy="17" r="6" fill="#f85149"/>
  <circle cx="52" cy="17" r="6" fill="#d29922"/>
  <circle cx="74" cy="17" r="6" fill="#3fb950"/>
  <text x="${width / 2}" y="22" text-anchor="middle" font-family="Consolas, 'Cascadia Mono', Menlo, monospace" font-size="12" fill="#8b949e">dsh-testgen — /testgen src/string-utils.ts</text>
  ${textSpans}
  <text x="${width - PAD_X}" y="${height - 8}" text-anchor="end" font-family="Consolas, 'Cascadia Mono', Menlo, monospace" font-size="11" fill="#484f58">dsh-testgen v1.0.0 · real node --test run, no mocks</text>
</svg>
`

writeFileSync(join(assets, 'demo-cli.svg'), svg)
console.log(`wrote assets/demo-cli.svg (${lines.length} lines, ${width}x${height})`)
