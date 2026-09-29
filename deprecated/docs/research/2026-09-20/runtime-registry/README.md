# Published Pillow tag recheck

On 20 September 2026 a direct HTTPS GET of the [public npm dist-tags endpoint](https://registry.npmjs.org/-/package/pillow-rs/dist-tags) returned the [retained JSON](dist-tags.json). The command was:

```sh
curl --fail --silent --show-error --max-time 30 https://registry.npmjs.org/-/package/pillow-rs/dist-tags
```

It exited 0. The browser research tool could not retrieve this endpoint or the npm package page, so the observation uses that direct registry response. `next` still names `12.2.0-alpha.1`; `latest` still names `0.1.3`. No application dependency or lockfile was changed. This checks tag state on that date, not registry signatures, future tag stability or production qualification. The migration continues to use the exact pinned package, not resolve a moving tag at runtime.
