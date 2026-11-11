const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const stageDir = __dirname;
const pyodideDir = path.join(stageDir, 'node_modules', 'pyodide');
const destination = path.join(stageDir, 'assets', 'pyodide');
const lock = require(path.join(pyodideDir, 'pyodide-lock.json'));
const version = require(path.join(pyodideDir, 'package.json')).version;
const roots = ['biopython', 'requests', 'micropip'];

async function main() {
  const required = new Set();
  const packages = [];
  function visit(name) {
    const pkg = lock.packages[name];
    if (!pkg) throw new Error(`Pyodide lock has no package named ${name}`);
    if (required.has(name)) return;
    required.add(name);
    for (const dependency of pkg.depends || []) visit(dependency);
  }
  for (const name of roots) visit(name);
  await fs.mkdir(destination, { recursive: true });

  for (const name of [...required].sort()) {
    const pkg = lock.packages[name];
    const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`;
    const target = path.join(destination, pkg.file_name);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== pkg.sha256) {
      throw new Error(`${pkg.file_name} SHA-256 mismatch: expected ${pkg.sha256}, got ${digest}`);
    }
    await fs.writeFile(target, bytes);
    console.log(`${name} ${pkg.version} ${bytes.length} bytes sha256=${digest}`);
    packages.push({
      name,
      version: pkg.version,
      file_name: pkg.file_name,
      sha256: digest
    });
  }
  await fs.writeFile(
    path.join(destination, 'manifest.json'),
    `${JSON.stringify({ pyodide: version, packages }, null, 2)}\n`
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
