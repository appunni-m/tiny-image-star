# Security policy

## Supported version

Tiny Image Star is pre-release. Only the current `main` branch is considered
for security fixes; there are no supported tagged versions or backport policy
yet. No response-time or disclosure-time guarantee is currently offered.

## Report a vulnerability privately

Do not open a public issue containing exploit details, a malicious image, or
private user data.

Use GitHub's **Report a vulnerability** action for this repository:

<https://github.com/appunni-m/tiny-image-star/security/advisories/new>

If GitHub does not present that private form, contact the repository owner
through their [GitHub profile](https://github.com/appunni-m) and ask for a
private reporting channel without including vulnerability details. The owner
should enable GitHub private vulnerability reporting before a public release.

Include the affected revision, browser/OS, impact, minimal reproduction, and a
safe proof of concept. Avoid real personal images and remove sensitive paths or
metadata.

## Trust boundary

The application is delivered as static HTML, CSS, JavaScript, and WebAssembly.
Image processing is intended to stay in the browser; the inspected application
source has no upload, analytics, telemetry, or image-processing network
endpoint. The hosting provider still receives normal requests for static site
assets.

Security still depends on:

- the browser and operating system enforcing their file and sandbox rules;
- the integrity of the GitHub Pages deployment and checked-in generated
  runtime;
- image decoders safely handling untrusted files;
- explicit browser permission for source/destination directory handles; and
- users reviewing the chosen destination before writing output files.

Local recipes, custom font files, recovery data, and large-job metadata may
persist in browser storage until cleared. The app's **Local data** control
removes those saved records. A font already loaded into the current page can
remain usable until refresh; the control does not delete downloaded files or
output already written to a selected folder.

Automated regression checks are evidence for specified behavior, not a claim
that the application or its dependencies are vulnerability-free.
