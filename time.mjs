// Intl supplies the browser's timezone rules; no timezone database to download.
export function partsAt(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    second: parts.second,
  };
}

// Return zero, one, or two instants: a skipped, ordinary, or repeated local time.
export function possibleInstants(date, time, timeZone) {
  const wallTime = `${date}T${time}:00.000Z`;
  const wallTimestamp = Date.parse(wallTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)
      || !Number.isFinite(wallTimestamp) || new Date(wallTimestamp).toISOString() !== wallTime
      || date.startsWith('0000')) {
    throw new Error('Choose a valid date and time.');
  }

  // ponytail: sample offsets within two days, covering IANA clock changes.
  // If sub-day, back-to-back rule changes ever appear, replace with Temporal.
  const offsets = new Set([-2, -1, 0, 1, 2].map(days => {
    const sample = wallTimestamp + days * 86_400_000;
    const parts = partsAt(sample, timeZone);
    return Date.parse(`${parts.date}T${parts.time}:${parts.second}Z`) - sample;
  }));

  return [...offsets].map(offset => wallTimestamp - offset)
    .filter(instant => {
      if (!Number.isFinite(instant)) return false;
      const parts = partsAt(instant, timeZone);
      return parts.date === date && parts.time === time && parts.second === '00';
    }).sort((a, b) => a - b);
}

export function readSelection(hash) {
  if (!hash || hash === '#') return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const at = params.get('at');
  const timeZone = params.get('tz');
  const hourFormat = params.get('format') ?? '24';
  const instant = Date.parse(at);
  if (params.getAll('at').length !== 1 || params.getAll('tz').length !== 1
      || params.getAll('format').length > 1 || !['12', '24'].includes(hourFormat)
      || !timeZone || !Number.isFinite(instant) || new Date(instant).toISOString() !== at) {
    throw new Error('This link is incomplete or invalid. Ask for a new link, or choose a time below.');
  }
  try {
    const parts = partsAt(instant, timeZone);
    if (!possibleInstants(parts.date, parts.time, timeZone).includes(instant)) throw new Error();
  } catch {
    throw new Error('This link has an invalid time or timezone. Ask for a new link, or choose a time below.');
  }
  return { instant, timeZone, hourFormat };
}

export function selectionURL(baseURL, instant, timeZone, hourFormat = '24') {
  const url = new URL(baseURL);
  url.hash = new URLSearchParams({ at: new Date(instant).toISOString(), tz: timeZone, format: hourFormat }).toString();
  return url.href;
}
