#!/usr/bin/env python3
"""Copy audit — catches the AI-UI tells (docs/frontend-DESIGN.md) before a judge does.

Rules:
  1. No user-facing string literal in a screen. All copy lives in src/lib/copy/.
  2. Em dashes in user-facing strings.
  3. ", never ..." rhetoric.

There is deliberately no "this string is too long" rule. It was tried and
dropped: every hit was consent text or a destructive-action confirmation, which
are long on purpose, and a check that is usually wrong is a check people learn
to skip.

Rule 1 replaces the old "muted text longer than six words" heuristic, which
went blind the moment screens started rendering {copy.x}: the regex matched the
text node, and there is no text node any more. Rather than fake a check it can
no longer make, the audit now enforces the thing that made it blind — the copy
really is all in one place — which is stronger and is what docs/frontend-DESIGN.md asks for.

Allowed: mark a deliberate line with  // voice-ok
Run: python3 scripts/copy-audit.py   (exit 1 if violations)
"""
import glob
import re
import sys

violations = []

SKIP_LINE = re.compile(r'^\s*(//|\*|/\*|\{/\*)')
# Attributes whose value a person reads.
COPY_ATTR = re.compile(
    r'\b(label|title|placeholder|hint|message|meta|retryLabel|emptySentence|'
    r'accessibilityLabel|accessibilityHint|detail|word)\s*=\s*[\'"]([^\'"]{2,})[\'"]')
# A JSX text node: >  Some words  <
JSX_TEXT = re.compile(r'>\s*([A-Za-z][^<>{}\n]*[A-Za-z.!?])\s*<')
# Two real words in a row: the signal that this is a phrase, not an identifier.
PHRASE = re.compile(r'[A-Za-z]{2,}\s+[A-Za-z]{2,}')

for path in sorted(glob.glob('src/**/*.ts*', recursive=True)):
    src = open(path).read()
    lines = src.split('\n')
    in_screen = path.startswith('src/app/')

    for i, l in enumerate(lines, 1):
        stripped = l.strip()
        if SKIP_LINE.match(l) or 'voice-ok' in l:
            continue
        code = l.split('//')[0]

        # --- 2. em dash inside a string literal -------------------------------
        # A bare '—' literal is the missing-value glyph ("LATENCY  —"), which is
        # typography, not prose: telemetry needs a character meaning "no reading"
        # that does not pretend to be one. Only em dashes with words around them
        # are the tell this rule is for.
        bare_glyph = re.sub(r'''(['"`])\s*[—–]\s*\1''', '""', code)
        if '—' in bare_glyph and re.search(r'''['"`][^'"`]*—''', bare_glyph):
            violations.append((path, i, f'em dash: {stripped[:60]}'))

        # --- 3. rhetoric ------------------------------------------------------
        if re.search(r'''['"`][^'"`]*, never ''', code):
            violations.append((path, i, f'rhetoric (", never"): {stripped[:60]}'))

        # --- 1. hardcoded copy in a screen ------------------------------------
        if in_screen:
            m = COPY_ATTR.search(code)
            if m and PHRASE.search(m.group(2)):
                violations.append((path, i, f'hardcoded copy in a screen: {m.group(1)}="{m.group(2)[:44]}"'))
            t = JSX_TEXT.search(code)
            if t and PHRASE.search(t.group(1)):
                violations.append((path, i, f'hardcoded copy in a screen: "{t.group(1)[:50]}"'))


if violations:
    for p, ln, msg in violations:
        print(f'{p}:{ln}  {msg}')
    print(f'\n{len(violations)} violation(s). Fix them or mark deliberate voice with // voice-ok')
    sys.exit(1)
print('Copy audit clean.')
