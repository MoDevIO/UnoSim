#!/bin/bash
set -e

echo "🔍 Simulating Vercel Build Environment..."
echo "=================================================="

# Clean previous build
echo "📦 Cleaning old build..."
rm -rf dist

# Run the exact build command from vercel.json
echo "🏗️  Running build command..."
npm ci --include=dev && npm run build

echo ""
echo "✅ Build successful!"
echo "=================================================="
echo "📁 Build artifacts:"
du -sh dist/
ls -lh dist/
echo ""
echo "🧪 Testing if dist/index.js is valid Node.js..."
node --check dist/index.js && echo "✅ Syntax valid!" || echo "❌ Syntax error!"
