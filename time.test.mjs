import assert from 'node:assert/strict';
import { partsAt, possibleInstants, readSelection, selectionURL } from './time.mjs';

const cases = [
  ['2026-07-15', '15:30', 'Europe/London', ['2026-07-15T14:30:00.000Z']],
  ['2026-01-15', '15:30', 'Europe/London', ['2026-01-15T15:30:00.000Z']],
  ['2026-07-15', '09:00', 'America/New_York', ['2026-07-15T13:00:00.000Z']],
  ['2026-01-15', '09:00', 'America/New_York', ['2026-01-15T14:00:00.000Z']],
  ['2026-03-08', '02:30', 'America/New_York', []],
  ['2026-11-01', '01:30', 'America/New_York', ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']],
  ['2026-03-29', '01:30', 'Europe/London', []],
  ['2026-10-25', '01:30', 'Europe/London', ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']],
  ['2026-04-05', '01:45', 'Australia/Lord_Howe', ['2026-04-04T14:45:00.000Z', '2026-04-04T15:15:00.000Z']],
  ['2026-10-04', '02:15', 'Australia/Lord_Howe', []],
  ['2026-01-15', '00:00', 'Asia/Kathmandu', ['2026-01-14T18:15:00.000Z']],
  ['1986-01-01', '00:05', 'Asia/Kathmandu', []],
  ['2026-01-15', '09:00', 'Pacific/Chatham', ['2026-01-14T19:15:00.000Z']],
  ['2026-01-01', '00:15', 'Pacific/Kiritimati', ['2025-12-31T10:15:00.000Z']],
  ['2011-12-30', '12:00', 'Pacific/Apia', []],
  ['2028-02-29', '00:00', 'UTC', ['2028-02-29T00:00:00.000Z']],
  ['1900-01-01', '09:00', 'Europe/Paris', ['1900-01-01T08:50:39.000Z']],
];
for (const [date, time, zone, expected] of cases) {
  const actual = possibleInstants(date, time, zone);
  assert.deepEqual(actual.map(at => new Date(at).toISOString()), expected, `${date} ${time} ${zone}`);
  for (const instant of actual) {
    for (const hourFormat of ['24', '12']) {
      const link = new URL(selectionURL('https://example.github.io/meet-time/', instant, zone, hourFormat));
      assert.equal(link.pathname, '/meet-time/');
      assert.equal(new URLSearchParams(link.hash.slice(1)).get('format'), hourFormat);
      assert.deepEqual(readSelection(link.hash), { instant, timeZone: zone, hourFormat });
    }
    assert.deepEqual(partsAt(instant, zone), { date, time, second: '00' });
  }
}

for (const [date, time] of [['2026-02-29', '12:00'], ['2026-01-15', '24:00'], ['', '09:00'], ['0000-01-01', '12:00']]) {
  assert.throws(() => possibleInstants(date, time, 'UTC'), /valid date and time/);
}
assert.throws(() => possibleInstants('2026-01-15', '12:00', 'Not/A_Zone'));
assert.equal(readSelection(''), null);
assert.equal(readSelection('#'), null);
for (const hash of [
  '#hello', '#at=tomorrow&tz=UTC', '#at=2026-01-15T12:00:00.000Z',
  '#at=2026-01-15T12:00:00.000Z&tz=Not%2FA_Zone',
  '#at=2026-02-30T12:00:00.000Z&tz=UTC',
  '#at=2026-01-15T12:00:00.000Z&tz=UTC&tz=Europe%2FLondon',
  '#at=2026-01-15T12:00:01.000Z&tz=UTC',
  '#at=2026-01-15T12:00:00.123Z&tz=UTC',
  '#at=2026-01-15T12:00:00.000Z&tz=UTC&format=25',
  '#at=2026-01-15T12:00:00.000Z&tz=UTC&format=',
  '#at=2026-01-15T12:00:00.000Z&tz=UTC&format=12&format=24',
]) assert.throws(() => readSelection(hash), /invalid/);

const meeting = Date.parse('2026-07-15T23:30:00.000Z');
assert.deepEqual(readSelection('#at=2026-07-15T23:30:00.000Z&tz=UTC'), {
  instant: meeting, timeZone: 'UTC', hourFormat: '24',
});
assert.equal(readSelection(new URL(selectionURL('https://example.github.io/meet-time/', meeting, 'UTC')).hash).hourFormat, '24');
assert.deepEqual(partsAt(meeting, 'Asia/Tokyo'), { date: '2026-07-16', time: '08:30', second: '00' });
assert.deepEqual(partsAt(meeting, 'America/Los_Angeles'), { date: '2026-07-15', time: '16:30', second: '00' });
console.log('Passed: timezone conversions, DST gaps/overlaps, fractional offsets, date boundaries, and URL validation/round trips with 12/24-hour formats and legacy defaults.');
