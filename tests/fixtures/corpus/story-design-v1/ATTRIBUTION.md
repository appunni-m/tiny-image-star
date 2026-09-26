# Story design inputs

These are development fixtures, excluded from the deployed site.
[Provenance](provenance.json) records the exact local source paths and SHA-256
digests.

`astronaut.png` is the NASA portrait of Eileen Collins distributed as the
public-domain astronaut sample in scikit-image v0.25.2. It is copied unchanged
from the [retained segmentation study](../../../../docs/SEGMENTATION_RESEARCH.md),
which records the versioned source documentation and input provenance.
No endorsement by NASA or the depicted person is implied.

`portrait-mask.png` is the retained study's selfie CPU mask for that same
portrait. The story test imports the existing PNG as a user-supplied mask; it
does not load a segmentation SDK or execute a model. This single mask is not
ground truth or an edge-quality qualification.

The same browser test reads the coast and food inputs from
[collections-v1](../collections-v1/ATTRIBUTION.md). Those photographs and their
downscaled stimuli are attributed there under CC0. The cat photograph is not
used in the story-design visual record. The resulting previews assess
composition with these three subjects, not representative demographic,
camera-format, color-management, or segmentation quality.
