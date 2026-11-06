# Timezone search data

`timezones.mjs` contains search metadata from [`@vvo/tzdb@6.202.0`](https://www.npmjs.com/package/@vvo/tzdb/v/6.202.0), under the included MIT license. The upstream project derives timezone data from [IANA](https://www.iana.org/time-zones), names from [Unicode CLDR](https://cldr.unicode.org/), and city names/populations from [GeoNames](https://www.geonames.org/) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).

Only the IANA groups, country names/codes, alternative names, major cities, and standard/daylight abbreviations are retained. Groups are upstream's present-day picker groupings, not necessarily historically interchangeable IANA aliases. The app uses them only for search metadata, never to merge saved zones or calculate offsets. The browser's `Intl` data remains responsible for timezone rules.

To regenerate from the repository root (change the pinned version when updating, and retrieve its LICENSE too):

```sh
node --input-type=module <<'JS'
import { writeFile } from 'node:fs/promises';
const base = 'https://unpkg.com/@vvo/tzdb@6.202.0/';
const response = await fetch(base + 'raw-time-zones.json');
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
const zones = await response.json();
const fields = ['group', 'alternativeName', 'countryName', 'countryCode', 'mainCities', 'abbreviation', 'dstAbbreviation'];
const data = zones.map(zone => Object.fromEntries(fields.filter(key => zone[key]).map(key => [key, zone[key]])));
await writeFile('vendor/tzdb/timezones.mjs', '// @vvo/tzdb 6.202.0 search metadata; see README.md and LICENSE.\nexport default ' + JSON.stringify(data, null, 2) + ';\n');
JS
```

After updating, run `node time.test.mjs` and the browser checks documented in the root README. Check both standard/daylight abbreviations, ambiguous IST matches, and Wellington. The app additionally recognizes `SGP` as a Singapore search alias; upstream provides `SG` and `SGT`.
