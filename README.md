# Meettime

[Open Meettime](https://meettime.at/)

Choose a date, time, and timezone, then press **Copy link** to share a meeting time. Anyone opening the link sees their local time first and can edit the meeting details below.

The site runs in your browser. You don't need an account, backend, or build step. The timezone converter and dropdown assets come from this repository. On `meettime.at` (or when explicitly testing analytics locally), the site also loads PostHog through `e.meettime.at` for usage analytics; it makes no search API requests.

Every dropdown uses the same searchable picker, including hours, AM/PM, clock format, and repeated-time choices. Both timezone pickers use the same labels, region groups, option order, and search, with your device's timezone first. They open on click, typing, or Arrow Down, not on focus alone. The meeting timezone applies immediately; additional zones require **Add timezone**. Minutes start with `00`, `15`, `30`, and `45`, followed by every other minute. The date field uses the browser's calendar picker.

## Run locally

From this directory:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Use this server instead of opening `index.html` directly so the browser can load the JavaScript modules. **Copy link** works on localhost and HTTPS. If your browser blocks clipboard access, the site selects the link so you can copy it yourself.

To send real events to PostHog during local testing, open http://localhost:8000/?analytics=1. Events have `environment: development`; filter on `environment: production` in your normal insights to exclude them. The switch works only on loopback hosts (`localhost`, `127.0.0.1`, or `[::1]`). Do Not Track, Global Privacy Control, and blockers still apply.

In your US PostHog project's live event view, filter on `environment: development`. Opening the local page sends `$pageview`; pressing **Copy link** sends `link_copied` with `timezone`. Open the copied local URL in a new tab to send `shared_link_opened` with `different_timezone`. Allow a few seconds for event batching. Normal local visits without `?analytics=1` send nothing.

## Deploy on GitHub Pages

1. Add this directory's contents to the **root** of a GitHub repository, including `.nojekyll`. Merge your feature branch through a pull request.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your default branch (usually `main`) and **/ (root)**, then save.
5. Once deployment finishes, open the URL GitHub provides, usually `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

Meettime uses the custom domain `meettime.at`, recorded in `CNAME`. Keep the matching custom domain configured in **Settings → Pages** and enable **Enforce HTTPS**.

You don't need a custom workflow or build configuration. Relative asset paths work at both a repository URL and a custom domain. Share links from the deployed site rather than localhost.

## How links work

```text
https://meettime.at/#at=2026-07-15T14%3A30%3A00.000Z&tz=Europe%2FLondon&format=24
```

- `at` is the exact UTC instant, and `tz` is the chosen IANA timezone. These values restore the date and time, including whether you chose the first or second occurrence of a repeated time.
- `format=24` or `format=12` saves the hour format for both the picker and result. New visits and links without this parameter default to 24-hour time. Switching formats keeps the same meeting time.
- The address bar and share link update when you change a field. Links you've already sent keep their original time.
- The browser doesn't send the URL fragment (everything after `#`) in HTTP requests. The site saves only manually selected preview timezones in local storage; opening a link does not change those preferences. Analytics exclude the fragment and query string. Only the selected timezone is sent when copying succeeds; the meeting date, time, and full link aren't sent to PostHog. GitHub still receives normal page requests.
- Your device or browser settings determine your timezone, not geolocation. Digits, date formatting, and AM/PM labels (in 12-hour mode) follow your browser's locale.
- The site rejects times skipped by a daylight-saving change. If a time happens twice when the clocks go back, you must choose the first or second time before copying a link. The browser's `Intl` data provides the timezone rules.
- Use a current version of Chrome, Firefox, Edge, or Safari that supports `Intl.supportedValuesOf`, and enable JavaScript.

## Preview other timezones

Expand **Other timezones** below the local-time result, select a timezone, then press **Add timezone** to add it. The picker stays visible while the section is expanded, but its dropdown opens only when you interact with it. Pressing Add without a selection shows a validation message without hiding the picker or opening its dropdown. You can add up to 10 additional zones. Your local time always keeps its prominent clock display, even with additional zones selected. Additional zones use compact rows inside the expandable section, with city, full timezone, date (including the year), and UTC offset. **Copy link** stays available above the results. Previews follow the meeting's 12/24-hour format and daylight-saving rules. Remove zones individually or use **Reset timezones** to clear all additional zones and their saved preference, without changing the meeting.

Links include the ordered list as repeated fragment parameters, for example `&preview=America%2FNew_York&preview=Asia%2FTokyo`. Empty lists add no parameters; old links still work. Equivalent aliases are deduplicated; unsupported or excess zones are omitted with a notice rather than breaking a valid meeting.

There are no tabs: your device's local time stays visible above the comparisons. **Other timezones** starts collapsed on every load, including shared links and restored preferences; its heading shows the selected-zone count. Expanding it reveals the comparisons and add form without automatically opening the dropdown. Closing it also closes any open timezone dropdown. Selecting a zone is a draft; it is added only when you submit **Add timezone**. Manually adding or removing zones saves the resulting list under `meettime.preview-timezones` in local storage for future new meetings on this browser. Opening a shared link uses only its list (empty for old links), never merges your saved defaults, and never changes storage. Changing the meeting time, expanding or collapsing the section, opening the picker, or copying a link does not save preferences either. Manually editing previews on a shared link does save that resulting list. Reset removes only this feature's storage key. Blocked or unavailable storage does not prevent previews or sharing, but preferences cannot be remembered.

## Analytics

On `meettime.at`, and on loopback hosts with `?analytics=1`, PostHog's US service receives one pageview per page load and five explicit event types through its managed proxy at `https://e.meettime.at`. Every event includes `environment` (`production` or `development`). Pageviews include `entry_type`: `new` for visits without a meeting selection, `shared` for valid meeting links, or `invalid` for malformed meeting links. This describes the initial URL, not whether the person is a returning visitor. Separate `new` and `shared` visits when measuring copy conversion: recipients can succeed just by reading the time.

- `shared_link_opened`: the initial URL contains a valid meeting link, with `different_timezone` indicating whether the meeting and viewer use different canonical IANA timezones. Aliases such as `US/Eastern` and `America/New_York` count as the same timezone. Different zones may have the same UTC offset on a given date. The viewer's exact timezone is not sent. This counts opens, including reloads and the sender reopening their own link, not unique recipients.
- `link_copied`: writing the link to the clipboard succeeds, with a `timezone` property containing the selected IANA timezone (for example, `Europe/London`). The value is captured when copying starts, so changes while the clipboard request is pending don't misattribute the copied link. In PostHog, create a Trends insight counting `link_copied` events and break down by the `timezone` event property to see the most-used timezones. This counts successful copies, not unique users or every dropdown change.
- `copy_failed`: writing to the clipboard fails and may require manual copying.
- `timezone_preview_opened`: a person expands **Other timezones**, with `preview_count` and `source` (`empty`, `saved`, or `link`, describing the list's initial source for this meeting). Loading a meeting, opening the picker inside the expanded section, or submitting an empty Add does not fire this event.
- `timezone_preview_changed`: an explicit list edit, with `action` (`add`, `remove`, or `reset`) and `preview_count`. Loading links or restoring preferences does not fire this event.

`link_copied` and `shared_link_opened` also include `preview_count`. Copy properties describe the link at the start of the clipboard operation. These counts measure feature adoption without sending the preview-zone list or search queries.

Changing fields or navigating between URL fragments doesn't create extra pageviews or shared-link-open events. Analytics are disabled on loopback hosts unless explicitly enabled with `?analytics=1`, on all other non-production hostnames, and when the browser signals Do Not Track or Global Privacy Control. Blocking PostHog doesn't prevent the converter or copying from working.

Autocapture, session recording, surveys, person profiles, and browser persistence are disabled. PostHog keeps an anonymous identifier in memory for the current page only; returning visitors and cross-page funnels cannot be measured reliably. Events allow only basic browser/device metadata and transient identifiers, plus the environment, pageview entry type, cross-timezone boolean on shared-link opens, selected timezone on `link_copied`, preview counts, and the preview actions/source described above. Saved preferences and preview-zone lists are not sent. No meeting date, time, other form values, URL query strings, or fragments are sent. Referrers are reduced to their origin. IP-based geolocation is disabled; PostHog still receives network requests and therefore sees the connection's IP address.

Useful PostHog insights (filter all of them to `environment: production`):

- Copy conversion and time to first copy: a funnel from `$pageview` filtered to `entry_type: new`, then `link_copied`. Break down by `$device_type` to compare mobile and desktop. Recipient visits are excluded from this creator funnel.
- Clipboard failure rate: a Trends formula `100 * A / (A + B)`, where A counts `copy_failed` and B counts `link_copied`. This measures clipboard attempts, not visitors; manual fallback copies aren't observable.
- Cross-timezone opens: count `shared_link_opened`, broken down by `different_timezone`.
- Timezone popularity: count `link_copied`, broken down by `timezone`.
- Preview adoption: count `timezone_preview_changed` with `action: add`, and break down successful `link_copied` events by `preview_count`.

Both the SDK download and event requests use `e.meettime.at`. PostHog manages the proxy and its HTTPS certificate; the subdomain's CNAME points to PostHog, while the website stays on GitHub Pages. The managed proxy routes traffic through Cloudflare as an additional processor. The PostHog UI remains at `https://us.posthog.com`. A proxy can reduce blocking but does not guarantee complete capture or override browser privacy signals.

The project token in `analytics.mjs` is public, not a personal API key. No backend or build configuration is needed. Review privacy notice and consent requirements before deploying; disabling persistence alone does not establish a consent exemption.

## For AI agents

Point your agent at the [Meettime skill](https://meettime.at/skills/meettime/SKILL.md) to create share links directly. [llms.txt](https://meettime.at/llms.txt) lists the instructions, and the homepage advertises it through HTML metadata without a visible footer link. Discovery depends on the agent; reading a skill from a URL does not necessarily install it.

The [discovery index](https://meettime.at/.well-known/agent-skills/index.json) follows the [Agent Skills discovery draft v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc). It points to the same skill and includes its SHA-256 digest. After editing `skills/meettime/SKILL.md`, run `shasum -a 256 skills/meettime/SKILL.md` and update the index's `digest` value (`sha256:` followed by the hash). The browser test checks that they match.

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

The checks cover skill discovery and its checksum, the documented example link, keyboard search, common-minute ordering, mobile and large-screen layouts, shared links, locale formatting, clipboard behavior, and analytics events/privacy with a mocked PostHog SDK (no test events reach PostHog). Preview checks cover link round trips, alias deduplication and limits, date rollover and DST, saved-default/link precedence, manual-only storage writes, reset, unavailable storage, analytics privacy, and the agent skill's multi-zone example. They also check that native selects still work if the optional picker script cannot load.

## Third-party code

The searchable menus use [Tom Select 2.6.2](https://tom-select.js.org/), included in `vendor/tom-select/` under the [Apache 2.0 license](vendor/tom-select/LICENSE). Only the base JavaScript bundle and core stylesheet load, about 17 KB combined with gzip compression. The base bundle includes its search dependencies; no plugins or framework runtime load.

The files come from the `tom-select@2.6.2` npm package. Source-map comments were removed because the maps are not included. Keep the license and version headers when updating these files.
