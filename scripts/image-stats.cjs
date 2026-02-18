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
  if (args.length < 2) {
    console.error('Usage: node scripts/image-stats.cjs <imageA.png> <imageB.png>');
    process.exit(2);
  }
  const [aPath, bPath] = args.map(p => require('path').resolve(p));
  if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) {
    console.error('Files not found:', aPath, bPath);
    process.exit(2);
  }

  const [aImg, bImg] = await Promise.all([readPng(aPath), readPng(bPath)]);
  if (aImg.width !== bImg.width || aImg.height !== bImg.height) {
    console.error('Different image dimensions');
    process.exit(2);
  }

  function stats(img) {
    const px = img.data;
    let r=0,g=0,b=0; let n = img.width*img.height;
    for (let i=0;i<px.length;i+=4) { r+=px[i]; g+=px[i+1]; b+=px[i+2]; }
    r/=n; g/=n; b/=n;
    const lum = 0.2126*r + 0.7152*g + 0.0722*b;
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b), lum: Math.round(lum) };
  }

  function samplePixel(img, x, y) {
    const { width, height, data } = img;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const idx = (width * y + x) << 2;
    return { r: data[idx], g: data[idx+1], b: data[idx+2], a: data[idx+3] };
  }

  const sa = stats(aImg);
  const sb = stats(bImg);
  console.log('Image A:', aPath, sa);
  console.log('Image B:', bPath, sb);
  console.log('Delta (B-A):', { r: sb.r - sa.r, g: sb.g - sa.g, b: sb.b - sa.b, lum: sb.lum - sa.lum });

  // sample top-left and center pixels for quick inspection
  const sampleCoords = [ [8,8], [Math.floor(aImg.width/2), Math.floor(aImg.height/2)] ];
  console.log('\nSampled pixels (A):');
  for (const [x,y] of sampleCoords) console.log(`  ${x},${y}:`, samplePixel(aImg,x,y));
  console.log('\nSampled pixels (B):');
  for (const [x,y] of sampleCoords) console.log(`  ${x},${y}:`, samplePixel(bImg,x,y));
})();