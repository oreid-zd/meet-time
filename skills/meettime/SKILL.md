---
name: meettime
description: Create Meettime links for sharing a meeting time that each recipient sees in their own timezone.
---

# Share a meeting time

Construct a URL and return it to the user. No account, API request, or browser automation is needed. A link displays a time; it does not book a meeting or send invitations.

## URL format

Use `https://meettime.at/` with these parameters in the fragment (after `#`), not the query string:

- `at`: the exact UTC instant as an ISO timestamp, including seconds, three millisecond digits, and `Z`, as produced by `Date.toISOString()`.
- `tz`: the source IANA timezone, such as `Europe/London` or `America/New_York`. This restores the editor's timezone; recipients see their own device's local time first.
- `format`: `24` or `12`. Omit it for the default, `24`.

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

The fragment is interpreted by the browser and is not sent to the web server. Fetching the URL over HTTP returns the static page, not a rendered timezone conversion.
