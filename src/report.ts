/**
 * Human-facing report rendering: plain text for the slash command, markdown
 * for documentation, JSON for scripted consumption.
 * @module dsh-testgen/report
 */

import type { TestgenReport } from './types.ts'

const STATUS_LABELS: Record<TestgenReport['status'], string> = {
  passed: 'PASSED',
  fixed: 'FIXED',
  generated: 'GENERATED',
  failed: 'FAILED',
  skipped: 'SKIPPED',
}

/** Plain multi-line rendering, shown as the `/testgen` command result. */
export function renderReportPlain(report: TestgenReport): string {
  const lines: string[] = []
  const status = report.status === 'fixed' ? 'FIXED (passing after fixes)' : STATUS_LABELS[report.status]
  lines.push(`Testgen ${status} in ${(report.elapsedMs / 1000).toFixed(1)}s`)

  if (report.targets.length > 0) {
    lines.push(`Targets (${report.targets.length}): ${report.targets.map((target) => target.path).join(', ')}`)
  }
  if (report.generated.length > 0) {
    for (const test of report.generated) {
      lines.push(`  wrote ${test.path} (${test.generator}, ${test.testCount} tests, ${test.framework})`)
    }
  }
  for (const run of report.runs) {
    const head = run.timedOut ? 'TIMEOUT' : run.exitCode === 0 ? 'PASS' : `FAIL (exit ${String(run.exitCode)})`
    const counts = run.summary ? ` — ${run.summary.passed} passed, ${run.summary.failed} failed${run.summary.skipped ? `, ${run.summary.skipped} skipped` : ''}` : ''
    lines.push(`Run #${run.iteration} ${run.framework}: ${head} in ${(run.durationMs / 1000).toFixed(1)}s${counts}`)
    const shown = run.failures.slice(0, 10)
    for (const failure of shown) {
      const name = failure.testName ? ` ${failure.testName}` : ''
      lines.push(`  ✗${name}`)
      for (const messageLine of failure.message.split('\n').slice(0, 4)) {
        lines.push(`    ${messageLine}`)
      }
    }
    if (run.failures.length > shown.length) {
      lines.push(`  … and ${run.failures.length - shown.length} more failure(s)`)
    }
  }
  if (report.stats.iterations > 1) {
    lines.push(`Summary: ${report.stats.generatedFiles} file(s), ${report.stats.iterations} run(s), ${report.stats.passed} passing, ${report.stats.failed} failing`)
  }
  for (const warning of report.warnings) {
    lines.push(`Warning: ${warning}`)
  }
  return lines.join('\n')
}

/** Markdown rendering used in docs and demos. */
export function renderReportMarkdown(report: TestgenReport): string {
  const lines: string[] = [`## Testgen ${STATUS_LABELS[report.status].toLowerCase()}`, '']
  lines.push(`| Metric | Value |`)
  lines.push(`|---|---|`)
  lines.push(`| Status | \`${report.status}\` |`)
  lines.push(`| Targets | ${report.targets.length} |`)
  lines.push(`| Generated files | ${report.stats.generatedFiles} |`)
  lines.push(`| Runner passes | ${report.stats.iterations} |`)
  lines.push(`| Passing | ${report.stats.passed} |`)
  lines.push(`| Failing | ${report.stats.failed} |`)
  lines.push(`| Wall clock | ${(report.elapsedMs / 1000).toFixed(2)}s |`)
  if (report.generated.length > 0) {
    lines.push('', '**Generated**', '')
    for (const test of report.generated) {
      lines.push(`- \`${test.path}\` (${test.generator} → ${test.framework}, ${test.testCount} tests)`)
    }
  }
  if (report.runs.length > 0) {
    lines.push('', '**Runs**', '')
    for (const run of report.runs) {
      lines.push(`- #${run.iteration} ${run.framework}: exit ${String(run.exitCode)} in ${(run.durationMs / 1000).toFixed(2)}s`)
    }
  }
  if (report.warnings.length > 0) {
    lines.push('', '**Warnings**', '')
    for (const warning of report.warnings) lines.push(`- ${warning}`)
  }
  return `${lines.join('\n')}\n`
}

/** Compact JSON rendering (the tool already returns the raw value; this is for `--json`). */
export function renderReportJson(report: TestgenReport): string {
  return JSON.stringify(report, null, 2)
}
