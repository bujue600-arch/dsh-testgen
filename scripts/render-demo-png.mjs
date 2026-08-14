#!/usr/bin/env node
/**
 * Renders the terminal demo SVG into a crisp PNG using the system Edge
 * browser (puppeteer-core, no download). Output: assets/demo-cli.png.
 */

import puppeteer from 'puppeteer-core'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgUrl = pathToFileURL(join(root, 'assets', 'demo-cli.svg')).href

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const browser = await puppeteer.launch({
  executablePath: EDGE_PATHS.find((candidate) => candidate.includes('x86') && candidate.includes('msedge')) ?? EDGE_PATHS[0],
  headless: true,
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 920, height: 220, deviceScaleFactor: 2 })
  await page.goto(svgUrl, { waitUntil: 'networkidle0' })
  await page.screenshot({ path: join(root, 'assets', 'demo-cli.png'), omitBackground: false })
  console.log('wrote assets/demo-cli.png')
} finally {
  await browser.close()
}
