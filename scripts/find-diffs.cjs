#!/usr/bin/env node
const fs = require('fs');
const { PNG } = require('pngjs');

function readPng(file) {
  return new Promise((res, rej) => {
    fs.createReadStream(file)
      .pipe(new PNG())
      .on('parsed', function () { res(this); })
      .on('error', rej);
  });
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) { console.error('Usage: node scripts/find-diffs.cjs <a.png> <b.png>'); process.exit(2); }
  const [aPath, bPath] = args.map(p => require('path').resolve(p));
  const [aImg, bImg] = await Promise.all([readPng(aPath), readPng(bPath)]);
  if (aImg.width !== bImg.width || aImg.height !== bImg.height) { console.error('Different dimensions'); process.exit(2); }
  const diffs = [];
  for (let y = 0; y < aImg.height; y++) {
    for (let x = 0; x < aImg.width; x++) {
      const idx = (aImg.width*y + x) << 2;
      const ar = aImg.data[idx], ag = aImg.data[idx+1], ab = aImg.data[idx+2];
      const br = bImg.data[idx], bg = bImg.data[idx+1], bb = bImg.data[idx+2];
      if (ar !== br || ag !== bg || ab !== bb) {
        diffs.push({x,y,a:[ar,ag,ab],b:[br,bg,bb]});
        if (diffs.length >= 40) break;
      }
    }
    if (diffs.length >= 40) break;
  }
  console.log('Found', diffs.length, 'sample differences (showing up to 40):');
  diffs.forEach(d => console.log(`${d.x},${d.y}  A=${d.a.join(',')}  B=${d.b.join(',')}`));
})();