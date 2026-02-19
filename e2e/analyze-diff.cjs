const fs = require('fs');
const PNG = require('pngjs').PNG;
const base = 'e2e/baseline-simulator.png';
const cur = 'e2e/current-simulator.png';
if (!fs.existsSync(base) || !fs.existsSync(cur)) {
  console.error('missing files');
  process.exit(2);
}
Promise.all([
  new Promise((res, rej) => fs.createReadStream(base).pipe(new PNG()).on('parsed', function () { res(this); }).on('error', rej)),
  new Promise((res, rej) => fs.createReadStream(cur).pipe(new PNG()).on('parsed', function () { res(this); }).on('error', rej)),
]).then(([b, c]) => {
  if (b.width !== c.width || b.height !== c.height) {
    console.log('dim mismatch');
    process.exit(2);
  }
  const w = b.width, h = b.height;
  const rowDiff = new Array(h).fill(0);
  const colDiff = new Array(w).fill(0);
  let totalDiff = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (w * y + x) << 2;
      const bd = (b.data[idx] !== c.data[idx]) || (b.data[idx+1] !== c.data[idx+1]) || (b.data[idx+2] !== c.data[idx+2]) || (b.data[idx+3] !== c.data[idx+3]);
      if (bd) { rowDiff[y]++; colDiff[x]++; totalDiff++; }
    }
  }
  const topRows = rowDiff.map((v,i)=>({i,v})).sort((a,b)=>b.v-a.v).slice(0,8);
  const topCols = colDiff.map((v,i)=>({i,v})).sort((a,b)=>b.v-a.v).slice(0,8);
  console.log('totalDiff', totalDiff, 'pixels out of', w*h);
  console.log('topRows', topRows);
  console.log('topCols', topCols);
  const rowsWithDiff = rowDiff.reduce((acc,v)=> v>0?acc+1:acc,0);
  console.log('rows with any diff:', rowsWithDiff, '/', h);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(2); });
