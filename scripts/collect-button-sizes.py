#!/usr/bin/env python3
import re
import os

# Tailwind height token to px mapping (assuming root 16px)
TW_H_MAP = {
    'h-4': '16px',
    'h-5': '20px',
    'h-6': '24px',
    'h-7': '28px',
    'h-8': '32px',
    'h-9': '36px',
    'h-10': '40px',
    'h-11': '44px',
}

ROOT = os.path.join(os.path.dirname(__file__), '..', 'client', 'src')
results = []

for dirpath, _, filenames in os.walk(ROOT):
    for fn in filenames:
        if not fn.endswith(('.tsx', '.ts', '.jsx', '.js')):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, 'r', encoding='utf-8') as f:
            text = f.read()
        for m in re.finditer(r"<Button([\s\S]{0,400}?)(?:>|/>)", text):
            chunk = m.group(1)
            # find className="..."
            cls_match = re.search(r'className\s*=\s*\{?\s*"([^"]+)"\s*\}?', chunk)
            if not cls_match:
                cls_match = re.search(r'className\s*=\s*\{\s*clsx\(([^\)]*)\)\s*\}', chunk)
            cls_text = cls_match.group(1) if cls_match else ''
            # also search for className={clsx('...','...')}
            if 'clsx' in chunk and not cls_match:
                cx = re.search(r"clsx\(([^\)]*)\)", chunk)
                if cx:
                    cls_text = cx.group(1)
            # collapse whitespace
            cls_text = re.sub(r"\s+", " ", cls_text.strip())

            # find explicit width classes
            w_match = re.search(r"w-\[[^\]]+\]|w-\d+|w-\d+\/\d+|w-\d+", cls_text)
            # find explicit height classes (either Tailwind token or var[])
            h_var = 'h-[var(--ui-button-height)]' in cls_text
            h_token = None
            for token in TW_H_MAP.keys():
                if token in cls_text:
                    h_token = token
                    break

            # determine expected px
            if h_var:
                height_px = '32px (var(--ui-button-height))'
            elif h_token:
                height_px = TW_H_MAP.get(h_token, 'unknown')
            else:
                # fallback: might rely on button component default
                height_px = 'button-variant-default (32px expected)'

            # width
            if w_match:
                w = w_match.group(0)
                if w == 'w-[var(--ui-button-height)]':
                    width_px = '32px (var(--ui-button-height))'
                elif w.startswith('w-') and w[2:].isdigit():
                    # tailwind numeric width like w-32 -> 8rem = 128px (approx)
                    width_px = w
                else:
                    width_px = w
            else:
                # no explicit width; if token is icon-size or square pattern, width may match height
                if 'icon' in chunk or 'size="icon"' in chunk:
                    width_px = '32px (icon -> square)'
                else:
                    width_px = 'auto / content'

            results.append({
                'file': os.path.relpath(path, os.path.join(os.path.dirname(__file__), '..')),
                'snippet': chunk.strip().split('\n')[0].strip(),
                'className': cls_text,
                'height': height_px,
                'width': width_px,
            })

# Print results
print('\nButton usage audit (expected computed sizes):\n')
for r in results:
    print(f"- File: {r['file']}")
    print(f"  Snippet: {r['snippet']}")
    print(f"  className: {r['className']}")
    print(f"  Expected height: {r['height']}")
    print(f"  Expected width: {r['width']}\n")

# Save as json
out = os.path.join(os.path.dirname(__file__), '..', 'button-size-audit.json')
with open(out, 'w') as f:
    import json
    json.dump(results, f, indent=2)
print('Saved audit to:', out)
