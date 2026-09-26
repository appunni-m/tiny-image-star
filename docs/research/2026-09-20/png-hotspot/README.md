# Tiny-PNG performance diagnosis — 20 September 2026

The completed [Auto calibration matrix](../auto-calibration/README.md) leaves one
measured timing failure: the current adapter takes 1.7246 times the legacy median
on the 8×8 PNG workflow, against an unchanged 1.50 limit. These probes ran **after**
that matrix finished. They change no production code, fixture, timing boundary,
budget or previous evidence.

## Separate adapter and runtime costs

The [crossed adapter/runtime probe](hotspot-probe.json) runs the same input through
four combinations. Each has 100 warmup calls, followed by five groups of 1,000
direct render calls in rotated order. All four outputs have identical dimensions,
encoded bytes and decoded-pixel hashes. The crossed combinations are diagnostic
and are not proposed deployment configurations.

| Adapter | Runtime | Median per direct render |
| --- | --- | ---: |
| Legacy | Legacy | 0.03209 ms |
| Current | Current published runtime | 0.05776 ms |
| Legacy | Current published runtime | 0.03494 ms |
| Current | Legacy | 0.05285 ms |

These calls exclude the canonical workflow's observation serialization and use
more iterations in one process. Their values must not replace its budget result.
The pattern points primarily to adapter behavior rather than a runtime-only
regression on this particular tiny input.

The [instrumented probe](stage-probe.json) shows why: the current adapter calls
`load()` and checks a pixel after reopening the encoded output; the legacy adapter
only reopens it and checks dimensions. The current output-validation stage averaged
0.0262 ms in that instrumented run, with `load()` accounting for 0.0223 ms per image.
Wrappers add overhead; these figures locate work and do not establish precise
un-instrumented stage costs or a percentage attribution.

## Full validation catches a real error

The [malformed-output probe](validation-probe.json) changes the IDAT zlib compression
method to an invalid value and recomputes the PNG chunk CRC. Both the valid and
invalid containers still report 8×8 through `Image.open()`. Only the valid image
passes complete decoding; the invalid one fails `load()` with an image error.

Header and dimension checks therefore cannot replace the current full output
validation. Removing it, moving it outside the timed job, or relaxing the 1.50
threshold would not resolve this gate. A future optimization must retain complete
corruption detection and pass the same canonical workflow and broader export
checks. The tiny-image failure remains open.

The [receipt](verification.json) hashes the scripts, results, logs, malformed
fixture and the relevant current/legacy code and runtime inputs. Original probe
scripts retain their absolute workspace paths; reproduce them against the source
archive identified in the Auto calibration record. This single tiny PNG does not
characterize camera-photo, other-format, browser or physical-phone performance.
