"""One module per detector. Each one exposes `BACKEND` and never raises on import.

bench.py globs this directory, so dropping a file in here is the whole
registration step. If a module's dependency is missing it sets
`BACKEND.available = False` and a note; the bench prints the reason and moves on.
"""
