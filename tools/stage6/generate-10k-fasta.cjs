const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'stage2', 'query.fasta');
const resultsDirectory = path.join(__dirname, 'results');
const outputPath = path.join(resultsDirectory, 'query-10000.fasta');
const manifestPath = path.join(resultsDirectory, 'query-10000.json');
const repeats = 1000;

function parseFasta(text) {
  const records = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      if (current) records.push(current);
      current = { header: line.slice(1), sequence: '' };
    } else if (line.trim()) {
      if (!current) throw new Error('FASTA sequence occurs before the first header');
      current.sequence += line.trim();
    }
  }
  if (current) records.push(current);
  return records;
}

const fixture = parseFasta(fs.readFileSync(sourcePath, 'utf8'));
if (fixture.length !== 10) {
  throw new Error(`Expected exactly 10 fixture records; found ${fixture.length}`);
}

const records = [];
const identifiers = new Set();
for (let repeat = 1; repeat <= repeats; repeat++) {
  const prefix = `repeat${String(repeat).padStart(4, '0')}_`;
  for (const record of fixture) {
    const header = `${prefix}${record.header}`;
    const identifier = header.split(/\s/, 1)[0];
    if (identifiers.has(identifier)) throw new Error(`Duplicate generated identifier: ${identifier}`);
    identifiers.add(identifier);
    records.push(`>${header}\n${record.sequence}\n`);
  }
}

if (records.length !== 10000 || identifiers.size !== 10000) {
  throw new Error(`Expected 10,000 unique records; found ${records.length}`);
}

fs.mkdirSync(resultsDirectory, { recursive: true });
const content = records.join('');
fs.writeFileSync(outputPath, content);
const manifest = {
  source: path.relative(path.resolve(__dirname, '..', '..'), sourcePath),
  sourceRecordCount: fixture.length,
  repeats,
  recordCount: records.length,
  uniqueIdentifierCount: identifiers.size,
  sizeBytes: Buffer.byteLength(content),
  sha256: crypto.createHash('sha256').update(content).digest('hex'),
  output: path.relative(path.resolve(__dirname, '..', '..'), outputPath)
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
