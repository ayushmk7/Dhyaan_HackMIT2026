#!/usr/bin/env python3
"""Copy audit — catches the AI-UI tells (DESIGN.md rules 1-3) before a judge does.

Flags:
  1. Muted/gray text longer than 6 words (ambient explanatory prose).
  2. Em dashes in user-facing strings.
Allowed: empty states and error messages (mark the line with  // voice-ok).
Run: python3 scripts/copy-audit.py   (exit 1 if violations)
"""
import glob
import re
import sys

violations = []

for path in glob.glob('src/**/*.ts*', recursive=True):
    src = open(path).read()
    lines = src.split('\n')

    for m in re.finditer(r'tone="muted"[^>]*>\s*\{?([^<{]+)', src):
        text = m.group(1).strip().strip('`\'"{}')
        line = src[:m.start()].count('\n') + 1
        if len(text.split()) > 6 and '?' not in text[:2] and 'voice-ok' not in lines[line - 1] and 'voice-ok' not in (lines[line] if line < len(lines) else ''):
            violations.append((path, line, f'gray prose: "{text[:60]}"'))

    for i, l in enumerate(lines, 1):
        stripped = l.strip()
        if stripped.startswith('//') or stripped.startswith('*') or 'voice-ok' in l:
            continue
        # em dash inside a string literal, not a code comment tail
        code = l.split('//')[0]
        if '—' in code and re.search(r'''['"`][^'"`]*—''', code):
            violations.append((path, i, f'em dash: {stripped[:60]}'))

if violations:
    for p, ln, msg in violations:
        print(f'{p}:{ln}  {msg}')
    print(f'\n{len(violations)} violation(s). Fix them or mark deliberate voice with // voice-ok')
    sys.exit(1)
print('Copy audit clean.')
