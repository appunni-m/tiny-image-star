# Support

Tiny Image Star is pre-release community software. Response times and a
long-term support window are not currently committed.

## Report a reproducible problem

Use the [bug report form](https://github.com/appunni-m/tiny-image-star/issues/new?template=bug_report.yml)
for application failures. Include:

- the exact visible error or unexpected result;
- browser name/version and operating system;
- the smallest sequence that reproduces it;
- input format, dimensions, and approximate file size;
- whether it affects one image, a small set, or the large-folder path; and
- whether `npm run verify:all` passes, if you can run the project locally.

Do not attach a private source image. Prefer a generated or sanitized sample
that preserves the failure. Remove local file names, folder paths, people,
location metadata, credentials, and other sensitive content from screenshots
and logs.

## Request a feature

Use the [feature request form](https://github.com/appunni-m/tiny-image-star/issues/new?template=feature_request.yml).
Describe the outcome and current workaround before proposing controls or
implementation details. Format requests must identify real input/output needs;
the UI exposes only formats verified by generated output bytes.

## Other routes

- Questions and reproducible bugs: public GitHub Issues.
- Security vulnerabilities: the private route in [SECURITY.md](SECURITY.md).
- Pillow-RS binding defects discovered by this app:
  [PILLOW_RS_ISSUES.md](PILLOW_RS_ISSUES.md); do not patch the external checkout
  from this repository.
