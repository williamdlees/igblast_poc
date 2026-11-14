const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { performance } = require('node:perf_hooks');

const MiB = 1024 * 1024;
const sizeMiB = Number(process.argv[2] || 50);
const repeats = Number(process.argv[3] || 3);
if (!Number.isInteger(sizeMiB) || sizeMiB < 1 ||
    !Number.isInteger(repeats) || repeats < 1) {
  throw new Error('Usage: node research\\tools\\stage6\\benchmark-native.cjs [sizeMiB] [repeats]');
}

const resultsDirectory = path.join(__dirname, 'results');
fs.mkdirSync(resultsDirectory, { recursive: true });
const sourcePath = path.join(resultsDirectory, 'native-input.bin');
const outputPath = path.join(resultsDirectory, 'native-output.bin');
const sizeBytes = sizeMiB * MiB;
const chunkSize = MiB;
const chunk = Buffer.allocUnsafe(chunkSize);

function pattern(offset, buffer) {
  for (let i = 0; i < buffer.length; i++) buffer[i] = (offset + i) % 251;
}

function generateInput() {
  const fd = fs.openSync(sourcePath, 'w');
  try {
    for (let offset = 0; offset < sizeBytes; offset += chunkSize) {
      const length = Math.min(chunkSize, sizeBytes - offset);
      pattern(offset, chunk.subarray(0, length));
      fs.writeSync(fd, chunk, 0, length, offset);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function copyOnce() {
  await pipeline(
    fs.createReadStream(sourcePath, { highWaterMark: 64 * 1024 }),
    fs.createWriteStream(outputPath, { highWaterMark: 64 * 1024 })
  );
  const output = await fs.promises.open(outputPath, 'r+');
  try {
    await output.sync();
  } finally {
    await output.close();
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  generateInput();
  const inputSha256 = await hashFile(sourcePath);
  const elapsedMs = [];
  for (let i = 0; i < repeats; i++) {
    const started = performance.now();
    await copyOnce();
    elapsedMs.push(Math.round((performance.now() - started) * 100) / 100);
  }
  const outputSha256 = await hashFile(outputPath);
  if (outputSha256 !== inputSha256 || fs.statSync(outputPath).size !== sizeBytes) {
    throw new Error('Native streaming copy failed size or SHA-256 verification');
  }
  const medianMs = median(elapsedMs);
  const result = {
    node: process.version,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model || 'unknown',
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    sizeBytes,
    sizeMiB,
    repeats,
    highWaterMarkBytes: 64 * 1024,
    inputSha256,
    outputSha256,
    roundTripMatches: true,
    copyElapsedMs: elapsedMs,
    medianMs,
    medianMiBPerSecond: Math.round((sizeMiB / (medianMs / 1000)) * 100) / 100
  };
  const outputFile = path.join(resultsDirectory, 'native-benchmark.json');
  fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
