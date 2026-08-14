const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const analyticsPage = path.join(
  repoRoot,
  'frontend',
  'app',
  '(app)',
  'tickets',
  'analytics',
  'page.jsx',
);

const em = '\u2014';
const dot = '\u00B7';
let s = fs.readFileSync(analyticsPage, 'utf8');
const lines = s.split(/\r?\n/);
for (const n of [49, 67, 94, 107, 108, 121, 122]) {
  let line = lines[n];
  line = line.replace(/reopen rate .* derived from stageHistory\{activeProject \? ` .* \$\{activeProject\.name\}` : ''\}\./,
    `reopen rate ${em} derived from stageHistory{activeProject ? \` ${dot} \${activeProject.name}\` : ''}.`);
  line = line.replace(/\{overview\.total\} tickets .* lane tiles/, `{overview.total} tickets ${dot} lane tiles`);
  line = line.replace(/: '-'\}/g, `: '${em}'}`);
  line = line.replace(/\?\? '-'\}/g, `?? '${em}'}`);
  line = line.replace(/measurable .* Early \{overview\.estimates\.early\} .*/, `measurable ${dot} Early {overview.estimates.early} ${dot}`);
  line = line.replace(/On time \{overview\.estimates\.onTime\} .* Late/, `On time {overview.estimates.onTime} ${dot} Late`);
  lines[n] = line;
}
s = lines.join('\n');
fs.writeFileSync(analyticsPage, s, 'utf8');
[50, 68, 95, 108, 109, 122, 123].forEach((n) => console.log('LINE ' + n + ': ' + lines[n - 1].trim()));