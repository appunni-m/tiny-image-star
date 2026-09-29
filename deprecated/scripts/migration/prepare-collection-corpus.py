"""Rebuild benchmark stimuli with CPython Pillow, never the app renderer.

Originals are pinned in corpus.json. Run from the repository root. This script
does not download anything and refuses changed originals or encoder versions.
"""
import hashlib
import json
from pathlib import Path
from PIL import Image, __version__

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "tests/fixtures/corpus/collections-v1"
assert __version__ == "11.3.0", f"Use Pillow 11.3.0; found {__version__}"
ORIGINALS = {
    "coast": "7e04ff95e47636399eaa2459685d0c8c1aca8ae6a4c439fd1345e2cc4f9634cc",
    "cat": "00414a33196666414be4e4e65a49e561c38c313cc0d24a94d2b72c40722e7876",
    "food": "4c4d2244285ee28b8f91e2f596529c45703297f1c24f895ddc13bebfc4ffa651",
}
assets = []

def record(name, path):
    with Image.open(path) as im:
        assets.append(dict(id=name, path=str(path.relative_to(ROOT)),
                           sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                           width=im.width, height=im.height,
                           media_type=Image.MIME[im.format]))

(BASE / "derived").mkdir(exist_ok=True)
for name, digest in ORIGINALS.items():
    path = BASE / "originals" / f"{name}.jpg"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    record(name, path)
    with Image.open(path) as source:
        image = source.convert("RGB")
        image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
        for extension in ("jpg", "png"):
            derived = BASE / "derived" / f"{name}-small.{extension}"
            image.save(derived, **(dict(quality=90, subsampling=0, optimize=False)
                                  if extension == "jpg" else dict(compress_level=6)))
            record(f"{name}-small-{extension}", derived)

corpus = dict(schema="tinystar/collection-corpus@1", assets=assets)
(BASE / "corpus.json").write_text(json.dumps(corpus, indent=2) + "\n")
print(f"Recorded {len(assets)} input assets; no expected outputs.")
