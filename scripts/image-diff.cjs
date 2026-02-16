#!/usr/bin/env node
/* scripts/image-diff.cjs — CommonJS version for ESM repo */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch').default || require('pixelmatch');

function readPng(file) {
  return new Promise((res, rej) => {
    fs.createReadStream(file)
      .pipe(new PNG())
      .on('parsed', function () {
        res(this);
      })
      .on('error', rej);
  });
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node scripts/image-diff.cjs <baseline.png> <current.png>');
    process.exit(2);
  }
  const [basePath, curPath] = args.map((p) => path.resolve(p));
  if (!fs.existsSync(basePath) || !fs.existsSync(curPath)) {
    console.error('Files not found:', basePath, curPath);
    process.exit(2);
  }

  const [baseImg, curImg] = await Promise.all([readPng(basePath), readPng(curPath)]);

  if (baseImg.width !== curImg.width || baseImg.height !== curImg.height) {
    console.error('Image dimensions differ:', baseImg.width, 'x', baseImg.height, 'vs', curImg.width, 'x', curImg.height);
    process.exit(2);
  }

  const diff = new PNG({ width: baseImg.width, height: baseImg.height });
  const diffPixels = pixelmatch(baseImg.data, curImg.data, diff.data, baseImg.width, baseImg.height, { threshold: 0.08 });

  // compute bounding box of differing pixels for quick localization
  let minX = baseImg.width, minY = baseImg.height, maxX = 0, maxY = 0;
  for (let y = 0; y < baseImg.height; y++) {
    for (let x = 0; x < baseImg.width; x++) {
      const idx = (baseImg.width * y + x) << 2;
      // diff pixel is non-zero when any channel differs
      if (diff.data[idx] || diff.data[idx + 1] || diff.data[idx + 2] || diff.data[idx + 3]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const total = baseImg.width * baseImg.height;
  const pct = (diffPixels / total) * 100;
  const outPath = path.join(path.dirname(basePath), 'diff-simulator.png');
  diff.pack().pipe(fs.createWriteStream(outPath));
  console.log(`Diff generated: ${outPath}`);
  console.log(`${diffPixels} pixels different (${pct.toFixed(4)}%)`);
  if (diffPixels > 0) {
    console.log(`Changed region bbox: x=${minX}..${maxX}, y=${minY}..${maxY} (w=${maxX-minX+1}, h=${maxY-minY+1})`);
    // quick heuristic: if the change is small, still return non-zero; otherwise also non-zero
    process.exit(1);
  } else {
    process.exit(0);
  }
})().catch((err) => {
  console.error(err);
  process.exit(2);
});