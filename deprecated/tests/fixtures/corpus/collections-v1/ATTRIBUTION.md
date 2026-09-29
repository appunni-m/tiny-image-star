# Collection benchmark photographs

These images are development inputs. The Pages assembly excludes this directory.
Originals were downloaded on 17 September 2026. `corpus.json` pins their bytes;
it contains no expected renderer output. No endorsement is implied.

| Local original | Author and source | License | Original dimensions |
| --- | --- | --- | --- |
| `coast.jpg` | Steffen Mokosch, [Calamillor1220236.jpg](https://commons.wikimedia.org/wiki/File:Calamillor1220236.jpg), own work, 24 December 2023 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | 4032 × 3024; Samsung SM-G980F metadata |
| `cat.jpg` | Reese Joyner, [Gray Cat.jpg](https://commons.wikimedia.org/wiki/File:Gray_Cat.jpg), own work, 20 February 2020 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 6000 × 4000; Canon EOS Rebel SL2 metadata |
| `food.jpg` | littlepepper, [Hoe (raw fish).jpg](https://commons.wikimedia.org/wiki/File:Hoe_(raw_fish).jpg), originally Pixabay 726739, 17 April 2015 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); Commons records license review on 18 February 2019 | 6000 × 4000 |

The `derived` files were converted to RGB, downscaled with Lanczos to a 1200 px
long edge and encoded as JPEG or PNG by CPython Pillow 11.3.0. Metadata is not
copied. They are small-image stimuli, not native camera originals. Rebuild with
`python3 scripts/migration/prepare-collection-corpus.py` from the repository root.

The cat photograph, its derived stimuli, and image outputs derived from it are
distributed under CC BY-SA 4.0 with the attribution above. The other photograph
derivatives remain available under CC0. This does not assign a license to the
application code. The benchmark is a throughput sample with three subjects;
it is not a segmentation-quality, photographic-diversity, color-management,
HEIC, HDR, P3, or physical-camera-import qualification corpus.

Original download locations:

- [Coast JPEG](https://upload.wikimedia.org/wikipedia/commons/b/bf/Calamillor1220236.jpg)
- [Cat JPEG](https://upload.wikimedia.org/wikipedia/commons/5/58/Gray_Cat.jpg)
- [Food JPEG](https://upload.wikimedia.org/wikipedia/commons/4/4f/Hoe_%28raw_fish%29.jpg)
