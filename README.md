# CastSD

CastSD is a static progressive web app and South Dakota fishing companion. It shows a curated set of public waters on a map, a species field guide, and a mark-based identifier you can use from a photo. Photos stay on the device. There is no account.

Waters and species notes are a field set, not the complete South Dakota Game, Fish and Parks inventory. Confirm seasons, limits, and access in the current handbook at [gfp.sd.gov](https://gfp.sd.gov).

## Run locally

This is a no-build static site: `index.html`, `app.js`, `data.js`, `styles.css`, a service worker, and a web app manifest. Serve the repository root:

```bash
npx serve .
```

Open the URL that command prints.

## Deploy

It deploys on Vercel as static files (`vercel.json` sets clean URLs and a short cache header). The live app is at https://castsd.vercel.app/.
