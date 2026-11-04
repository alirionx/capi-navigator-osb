// Turns Renovate's file report (--report-type=file) into docs/versions-report.md (ADR-0010).
// Usage: node scripts/versions-report.mjs <report.json> <renovate version> <token used: true|false>
import { readFileSync } from 'node:fs';

const [reportPath, renovateVersion, tokenUsed] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const RANK = { major: 3, minor: 2, patch: 1, digest: 0 };

const rows = [];
const problems = [];
let skipped = 0;
for (const repo of Object.values(report.repositories)) {
  for (const p of repo.problems ?? []) if (p.message) problems.push(p.message);
  for (const [manager, files] of Object.entries(repo.packageFiles)) {
    for (const file of files) {
      for (const dep of file.deps) {
        // Runner images (ubuntu-latest) and setup-node reading .nvmrc carry no version of their own.
        if (dep.skipReason) {
          skipped += 1;
          continue;
        }
        const updates = (dep.updates ?? []).filter((u) => u.updateType in RANK);
        const newest = updates.sort((a, b) => RANK[b.updateType] - RANK[a.updateType])[0];
        rows.push({
          name: dep.depName ?? '?',
          file: file.packageFile,
          manager,
          current: dep.currentValue ?? '?',
          newest: newest ? (newest.newValue ?? newest.newVersion) : '–',
          status: status(newest),
          outdated: Boolean(newest),
        });
      }
    }
  }
}

function status(update) {
  if (!update) return 'up to date';
  const age = update.newVersionAgeInDays;
  const released = age === undefined ? 'recently' : age === 0 ? 'today' : `${age} days ago`;
  const waiting = update.pendingChecks
    ? ` (released ${released}; wait for the minimum release age)`
    : '';
  return `**${update.updateType}**${waiting}`;
}

const cell = (value) => String(value).replace(/\|/g, '\\|');
const today = new Date().toISOString().slice(0, 10);
const outdated = rows.filter((r) => r.outdated).length;
const out = [
  '# Version report',
  '',
  `Generated on ${today} by \`pnpm versions:report\` (Renovate ${renovateVersion}, lookups only` +
    `${tokenUsed === 'true' ? '' : ', without GitHub token: GitHub lookups may be missing'}). ` +
    'How to update a version: [maintenance.md](maintenance.md).',
  '',
  `**${rows.length} pinned versions**, ${outdated} with a newer version. npm packages are not part of this report: run \`pnpm outdated\`.` +
    (skipped > 0
      ? ` ${skipped} entries without a version of their own are left out (runner images, Node.js from .nvmrc).`
      : ''),
  '',
  '| Dependency | Current | Newest | Update | Change in |',
  '| --- | --- | --- | --- | --- |',
  ...rows
    .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
    .map(
      (r) =>
        `| ${cell(r.name)} | ${cell(r.current)} | ${cell(r.newest)} | ${r.status} | ${cell(r.file)} |`,
    ),
  '',
];
if (problems.length > 0) {
  out.push('## Problems reported by Renovate', '', ...problems.map((p) => `- ${p}`), '');
}
process.stdout.write(out.join('\n'));
