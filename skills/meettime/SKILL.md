---
name: meettime
description: Create Meettime links with optional extra timezone previews for sharing a meeting time that each recipient sees in their own timezone.
---

# Share a meeting time

Construct a URL and return it to the user. No account, API request, or browser automation is needed. A link displays a time; it does not book a meeting or send invitations.

## URL format

Use `https://meettime.at/` with these parameters in the fragment (after `#`), not the query string:

- `at`: the exact UTC instant as an ISO timestamp, including seconds, three millisecond digits, and `Z`, as produced by `Date.toISOString()`.
- `tz`: the source IANA timezone, such as `Europe/London` or `America/New_York`. This restores the editor's timezone; recipients see their own device's local time first.
- `format`: `24` or `12`. Omit it for the default, `24`.
- `preview`: an optional additional IANA timezone. Repeat the parameter for each zone, in display order, with at most 10 distinct zones. Deduplicate aliases of the same timezone; do not deduplicate different zones just because they share a UTC offset. Omit it when no previews are requested.

Use whole-minute times in the source timezone. Resolve the user's date and local time with a timezone-aware library or runtime before constructing the URL. Do not guess a UTC offset or treat the local time as UTC. Ask for the timezone if it is unclear. If daylight saving skips the requested time, ask for another time; if it occurs twice, ask which occurrence to use.

Encode the fragment with `URLSearchParams` or an equivalent URL encoder. For 15 July 2026 at 15:30 in London (UTC+01:00), the UTC instant is 14:30:

```text
https://meettime.at/#at=2026-07-15T14%3A30%3A00.000Z&tz=Europe%2FLondon&format=24
```

Once the UTC instant is known, the equivalent JavaScript is:

```js
const url = new URL("https://meettime.at/");
url.hash = new URLSearchParams({
  at: "2026-07-15T14:30:00.000Z",
  tz: "Europe/London",
  format: "24",
}).toString();
// Return url.href to the user.
```

## Preview other timezones

Include previews when the user asks to compare other timezones. Do not invent default zones. Use IANA names, not ambiguous abbreviations such as CST or fixed offsets. All previews display the same `at` instant using the chosen `format`, with their local dates and date-specific UTC offsets.

The same London meeting, also previewed in New York and Tokyo:

```text
https://meettime.at/#at=2026-07-15T14%3A30%3A00.000Z&tz=Europe%2FLondon&format=24&preview=America%2FNew_York&preview=Asia%2FTokyo
```

When constructing the fragment in JavaScript, append each preview separately before assigning it to the URL:

```js
const params = new URLSearchParams({
  at: "2026-07-15T14:30:00.000Z",
  tz: "Europe/London",
  format: "24",
});
for (const zone of ["America/New_York", "Asia/Tokyo"])
  params.append("preview", zone);
const url = new URL("https://meettime.at/");
url.hash = params.toString();
// Return url.href to the user.
```

The preview always shows the recipient's local time as a prominent clock. Additional zones appear in compact rows inside **Other timezones**, which starts collapsed on every load and shows the selected-zone count in its heading. Expanding it keeps the prominent local clock visible above the comparisons. There are no tabs. The timezone picker remains visible while the section is expanded and does not preopen. Both timezone pickers share labels, region groups, option order, and search behavior; they open on click, typing, or Arrow Down, not on focus alone. The meeting timezone applies immediately, while preview selections require Add. Select a timezone, then press **Add timezone** to add it; an empty Add shows a validation message without hiding the picker. Draft selections do not change the link or saved preferences until added. **Copy link** is always available above the results.

Links are self-contained: agents do not need browser storage or an API. Opening a link uses only its preview list, even when that list is empty; it does not import or overwrite the viewer's saved defaults. Only manually adding, removing, or resetting previews changes the browser's preference for future new meetings. Reset clears additional zones and their saved preference, not the meeting itself. Invalid, duplicate, or excess preview zones are omitted without invalidating the meeting; invalid meeting parameters still produce an error.

The fragment is interpreted by the browser and is not sent to the web server. Fetching the URL over HTTP returns the static page, not a rendered timezone conversion.
