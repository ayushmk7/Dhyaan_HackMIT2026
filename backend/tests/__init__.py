# Deliberately a package, not a namespace directory.
#
# `ultralytics` (the camera lane's person detector) ships a top-level `tests/`
# into site-packages. A regular package there beats a namespace directory here
# whatever the sys.path order, so without this file every
# `from tests.conftest import ...` in the suite imports ultralytics' conftest
# and the collection errors out. One empty file is the whole fix.
