# Meettime

[Open Meettime](https://oreid-zd.github.io/meet-time/)

Choose a date, time, and timezone, then press **Copy link** to share a meeting time. Anyone opening the link sees their local time first and can edit the meeting details below.

The site runs in your browser. You don't need an account, backend, or build step. All assets come from this repository; the site makes no CDN or search API requests.

You can search the timezone and minute menus. Timezones are grouped by region, with your device's timezone first. Minutes start with `00`, `15`, `30`, and `45`, followed by every other minute. The date picker and short hour/AM-PM lists use native browser controls.

## Run locally

From this directory:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Use this server instead of opening `index.html` directly so the browser can load the JavaScript modules. **Copy link** works on localhost and HTTPS. If your browser blocks clipboard access, the site selects the link so you can copy it yourself.

## Deploy on GitHub Pages

1. Add this directory's contents to the **root** of a GitHub repository, including `.nojekyll`. Merge your feature branch through a pull request.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your default branch (usually `main`) and **/ (root)**, then save.
5. Once deployment finishes, open the URL GitHub provides, usually `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

You don't need a custom workflow or build configuration. Relative asset paths work at both a repository URL and a custom domain. Share links from the deployed site rather than localhost.

## How links work

```text
https://oreid-zd.github.io/meet-time/#at=2026-07-15T14%3A30%3A00.000Z&tz=Europe%2FLondon&format=24
```

- `at` is the exact UTC instant, and `tz` is the chosen IANA timezone. These values restore the date and time, including whether you chose the first or second occurrence of a repeated time.
- `format=24` or `format=12` saves the hour format for both the picker and result. New visits and links without this parameter default to 24-hour time. Switching formats keeps the same meeting time.
- The address bar and share link update when you change a field. Links you've already sent keep their original time.
- The browser doesn't send the URL fragment (everything after `#`) in HTTP requests. The site doesn't use analytics or save application data. GitHub still receives normal page requests.
- Your device or browser settings determine your timezone, not geolocation. Digits, date formatting, and AM/PM labels (in 12-hour mode) follow your browser's locale.
- The site rejects times skipped by a daylight-saving change. If a time happens twice when the clocks go back, you must choose the first or second time before copying a link. The browser's `Intl` data provides the timezone rules.
- Use a current version of Chrome, Firefox, Edge, or Safari that supports `Intl.supportedValuesOf`, and enable JavaScript.

## Check the timezone logic

With Node.js 18 or later:

```sh
node time.test.mjs
```

Checks include winter/summer offsets, skipped and repeated times, half-hour DST changes, quarter-hour offsets, a skipped calendar day, historical second-based offsets, date rollover, invalid links, restoring both hour formats from a URL, and the default format for older links.

## Browser checks

With Google Chrome installed, install Playwright for local testing only:

```sh
npm install --no-save --package-lock=false playwright
node browser.test.mjs
```

If you already have Playwright installed elsewhere, set `PLAYWRIGHT_MODULE` to its `index.mjs` path instead. The test starts its own local server and writes screenshots to your system's temporary directory.

The checks cover keyboard search, common-minute ordering, mobile and large-screen layouts, shared links, locale formatting, and clipboard behavior. They also check that native selects still work if the optional picker script cannot load.

## Third-party code

The searchable menus use [Tom Select 2.6.2](https://tom-select.js.org/), included in `vendor/tom-select/` under the [Apache 2.0 license](vendor/tom-select/LICENSE). Only the base JavaScript bundle and core stylesheet load, about 17 KB combined with gzip compression. The base bundle includes its search dependencies; no plugins or framework runtime load.

The files come from the `tom-select@2.6.2` npm package. Source-map comments were removed because the maps are not included. Keep the license and version headers when updating these files.
