"""Generate first-party HEIC capability inputs with macOS ImageIO via sips.

This is a decoder capability spike, not a camera/color/memory qualification.
No application renderer or third-party photographs produce the inputs.
"""
import hashlib
import json
import platform
import subprocess
from pathlib import Path
from PIL import Image, __version__

base = Path(__file__).resolve().parent
assert platform.system() == 'Darwin', 'This fixture preparation uses macOS sips'
assert __version__ == '11.3.0', 'Use the recorded Pillow 11.3.0 input generator'
directory = base / 'inputs'
directory.mkdir(exist_ok=True)
records = []
for name, alpha in [('opaque', False), ('alpha', True)]:
    image = Image.new('RGBA', (256, 192))
    pixels = image.load()
    colors = [(220, 35, 55), (30, 180, 70), (35, 70, 220), (220, 185, 30)]
    for y in range(image.height):
        for x in range(image.width):
            color = colors[(y >= 96) * 2 + (x >= 128)]
            # Asymmetric stripes distinguish rotation/mirroring without fonts.
            if 16 <= x < 32 and 8 <= y < 72:
                color = (240, 240, 240)
            pixels[x, y] = (*color, (x * 255 // 255) if alpha else 255)
    png = directory / (name + '.png')
    heic = directory / (name + '.heic')
    image.save(png, compress_level=6)
    command = ['/usr/bin/sips', '-s', 'format', 'heic', str(png), '--out', str(heic)]
    result = subprocess.run(command, capture_output=True, text=True)
    record = {'id': name, 'width': image.width, 'height': image.height,
              'source': str(png.relative_to(base)), 'source_sha256': hashlib.sha256(png.read_bytes()).hexdigest(),
              'candidate': str(heic.relative_to(base)), 'encoder_status': result.returncode,
              'encoder_log': result.stdout + result.stderr}
    if result.returncode == 0 and heic.is_file():
        encoded = heic.read_bytes()
        assert encoded[4:8] == b'ftyp', 'Encoder did not return an ISO BMFF file'
        record.update(sha256=hashlib.sha256(encoded).hexdigest(), bytes=len(encoded))
    records.append(record)
inventory = {'schema': 'tinystar/heic-spike-inputs@1', 'purpose': 'Basic native decoder capability only',
             'preparation': {'python': platform.python_version(), 'pillow': __version__, 'os': platform.platform(),
                             'sips': subprocess.run(['/usr/bin/sips', '--version'], capture_output=True, text=True).stdout.strip()},
             'inputs': records}
(base / 'inputs.json').write_text(json.dumps(inventory, indent=2) + '\n')
print(json.dumps(inventory, indent=2))
