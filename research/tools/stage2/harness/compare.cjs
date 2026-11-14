const fs = require('node:fs');

function readTsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
  const columns = lines.shift().split('\t');
  if (new Set(columns).size !== columns.length) throw new Error(`${file}: duplicate columns`);
  const rows = new Map();
  for (const line of lines) {
    const values = line.split('\t');
    if (values.length !== columns.length) throw new Error(`${file}: wrong field count`);
    const row = Object.fromEntries(columns.map((name, i) => [name, values[i]]));
    if (!row.sequence_id || rows.has(row.sequence_id)) throw new Error(`${file}: missing or duplicate sequence ID`);
    rows.set(row.sequence_id, row);
  }
  return { columns, rows };
}

if (process.argv.length !== 4) throw new Error('Usage: node compare.cjs native.tsv browser.tsv');
const native = readTsv(process.argv[2]);
const browser = readTsv(process.argv[3]);
const required = ['sequence_id', 'sequence', 'locus', 'v_call', 'd_call', 'j_call',
  'productive', 'rev_comp', 'junction', 'junction_aa'];
for (const name of required) {
  if (!native.columns.includes(name) || !browser.columns.includes(name)) {
    throw new Error(`Missing AIRR column: ${name}`);
  }
}
if (native.columns.join('\t') !== browser.columns.join('\t')) throw new Error('Column lists differ');
if (!native.rows.size || native.rows.size !== browser.rows.size) throw new Error('Row counts differ or are empty');
const differences = [];
for (const [id, row] of native.rows) {
  const other = browser.rows.get(id);
  if (!other) throw new Error(`Browser result missing ${id}`);
  for (const name of native.columns) {
    if (row[name] !== other[name]) differences.push({ id, column: name, native: row[name], browser: other[name] });
  }
}
console.log(JSON.stringify({ rows: native.rows.size, columns: native.columns.length,
  sample: Object.fromEntries(required.map(name => [name, native.rows.values().next().value[name]])),
  differences }, null, 2));
if (differences.length) process.exitCode = 1;
