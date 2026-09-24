import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = new URL('.', import.meta.url);
const assets = {
  'index.html': 'text/html', 'style.css': 'text/css', 'app.mjs': 'text/javascript', 'time.mjs': 'text/javascript',
  'vendor/tom-select/tom-select.min.css': 'text/css',
  'vendor/tom-select/tom-select.base.min.js': 'text/javascript',
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/meet-time/' ? 'index.html' : path.replace(/^\/meet-time\//, '');
  if (!assets[file]) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': assets[file] });
  res.end(await readFile(new URL(file, root)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/meet-time/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function newPage(options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
async function setFields(page, date, hour, minute, zone, hourFormat = '12') {
  await page.locator('#hour-format').selectOption(hourFormat);
  await page.locator('#date').fill(date);
  await page.locator('#hour').selectOption(String(hourFormat === '12' ? Number(hour) % 12 || 12 : Number(hour)));
  await page.locator('#minute').evaluate((select, value) => select.tomselect.setValue(value), minute);
  if (hourFormat === '12') await page.locator('#period').selectOption(Number(hour) < 12 ? '0' : '12');
  await page.locator('#timezone').evaluate((select, value) => select.tomselect.setValue(value), zone);
}
try {
  const sender = await newPage({ timezoneId: 'Europe/London', locale: 'en-GB', viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await sender.goto(base);
  await sender.locator('#copy:not([disabled])').waitFor();
  assert.equal(await sender.locator('#timezone').inputValue(), 'Europe/London');
  assert.equal(await sender.locator('#hour-format').inputValue(), '24');
  assert.equal(await sender.locator('#period').isVisible(), false);
  assert.equal(new URLSearchParams(new URL(sender.url()).hash.slice(1)).get('format'), '24');
  assert.equal(await sender.locator('#meeting > :first-child').getAttribute('id'), 'editor');
  assert.equal(await sender.locator('#copy-fallback').isVisible(), false);
  assert.equal(await sender.locator('#share-url').isVisible(), false);
  assert.equal(await sender.getByRole('button', { name: 'Copy link', exact: true }).count(), 1);
  assert.equal(await sender.locator('#preview #copy').count(), 1);
  await setFields(sender, '2026-07-15', '15', '30', 'Europe/London');
  assert.equal(await sender.locator('#local-time').innerText(), '3:30 pm');
  assert.equal(await sender.locator('#hour').inputValue(), '3');
  assert.equal(await sender.locator('#period option:checked').innerText(), 'pm');
  const link = await sender.locator('#share-url').inputValue();
  assert.equal(new URLSearchParams(new URL(link).hash.slice(1)).get('at'), '2026-07-15T14:30:00.000Z');
  assert.equal(new URL(link).pathname, '/meet-time/');
  assert.equal(new URLSearchParams(new URL(link).hash.slice(1)).get('format'), '12');
  await sender.locator('#copy').click();
  assert.equal(await sender.evaluate(() => navigator.clipboard.readText()), link);
  assert.equal(await sender.locator('#copy-label').innerText(), 'Copied!');
  assert.equal(await sender.locator('#copy-status').innerText(), '');
  await sender.screenshot({ path: join(tmpdir(), 'meet-time-desktop.png'), fullPage: true });
  await sender.waitForFunction(() => document.getElementById('copy-label').textContent === 'Copy link', null, { timeout: 4500 });
  await sender.locator('#copy').click();
  await sender.waitForTimeout(1800);
  await sender.locator('#copy').click();
  await sender.waitForTimeout(1800);
  assert.equal(await sender.locator('#copy-label').innerText(), 'Copied!');
  await sender.waitForFunction(() => document.getElementById('copy-label').textContent === 'Copy link', null, { timeout: 4500 });
  assert.equal(await sender.locator('#copy-status').innerText(), '');

  const receiver = await newPage({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  await receiver.goto(link);
  await receiver.locator('#copy:not([disabled])').waitFor();
  assert.equal(await receiver.locator('#local-time').innerText(), '7:30 AM');
  assert.match(await receiver.locator('#local-date').innerText(), /Wednesday, July 15, 2026/);
  assert.equal(await receiver.locator('#hour').inputValue(), '3');
  assert.equal(await receiver.locator('#period option:checked').innerText(), 'PM');
  assert.equal(await receiver.locator('#timezone').inputValue(), 'Europe/London');
  assert.equal(await receiver.locator('#share-url').inputValue(), link);
  assert.equal(await receiver.locator('#meeting > :first-child').getAttribute('id'), 'preview');
  await receiver.locator('#copy').focus();
  await receiver.keyboard.press('Tab');
  assert.equal(await receiver.evaluate(() => document.activeElement.id), 'hour-format');
  assert.equal(await receiver.locator('#hour-format').inputValue(), '12');
  await receiver.goto(link.replace('&format=12', ''));
  await receiver.locator('#copy:not([disabled])').waitFor();
  assert.equal(await receiver.locator('#hour-format').inputValue(), '24');
  assert.equal(await receiver.locator('#local-time').innerText(), '07:30');
  assert.equal(await receiver.locator('#hour').inputValue(), '15');
  await receiver.goto(link);
  await receiver.locator('#copy:not([disabled])').waitFor();

  const mobile = await newPage({ timezoneId: 'Asia/Tokyo', locale: 'en-US', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await setFields(sender, '2026-07-15', '23', '30', 'UTC');
  await mobile.goto(await sender.locator('#share-url').inputValue());
  await mobile.locator('#copy:not([disabled])').waitFor();
  assert.equal(await mobile.locator('#local-time').innerText(), '8:30 AM');
  assert.match(await mobile.locator('#local-date').innerText(), /Thursday, July 16, 2026/);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const positions = await mobile.evaluate(() => ({ preview: document.querySelector('.preview').getBoundingClientRect().top, editor: document.querySelector('.editor').getBoundingClientRect().top }));
  assert.ok(positions.preview < positions.editor);
  assert.ok((await mobile.locator('#local-time').boundingBox()).y < 812);
  await mobile.screenshot({ path: join(tmpdir(), 'meet-time-mobile.png'), fullPage: true });
  await mobile.setViewportSize({ width: 320, height: 812 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.goto(base);
  await mobile.locator('#copy:not([disabled])').waitFor();
  assert.equal(await mobile.locator('#meeting > :first-child').getAttribute('id'), 'editor');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const hourFormat of ['24', '12']) {
    await mobile.locator('#hour-format').selectOption(hourFormat);
    await mobile.getByRole('combobox', { name: 'Minute', exact: true }).focus();
    await mobile.keyboard.press('ArrowDown');
    await mobile.locator('.ts-dropdown.minute-picker').waitFor();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.keyboard.press('Escape');
  }

  const pickers = await newPage({ timezoneId: 'Europe/London', locale: 'en-GB', viewport: { width: 3440, height: 1440 } });
  await pickers.goto(link);
  await pickers.locator('#copy:not([disabled])').waitFor();
  assert.ok((await pickers.locator('.page').boundingBox()).width >= 900);
  assert.ok((await pickers.locator('#date').boundingBox()).height >= 60);
  const beforeBrandClick = pickers.url();
  await pickers.locator('.brand').click();
  assert.equal(pickers.url(), beforeBrandClick);
  assert.equal(await pickers.locator('.brand').getAttribute('href'), null);
  await pickers.screenshot({ path: join(tmpdir(), 'meet-time-large.png'), fullPage: true });

  const zoneSearch = pickers.getByRole('combobox', { name: 'Timezone', exact: true });
  const minuteSearch = pickers.getByRole('combobox', { name: 'Minute', exact: true });
  await zoneSearch.fill('New York');
  await pickers.locator('.ts-dropdown .active[data-value="America/New_York"]').waitFor();
  await pickers.screenshot({ path: join(tmpdir(), 'meet-time-timezone-search.png'), fullPage: true });
  await pickers.keyboard.press('Enter');
  assert.equal(await pickers.locator('#timezone').inputValue(), 'America/New_York');
  assert.equal(new URLSearchParams(new URL(pickers.url()).hash.slice(1)).get('tz'), 'America/New_York');
  const beforeSearch = pickers.url();
  await zoneSearch.fill('<img src=x onerror=alert(1)>');
  await pickers.locator('.ts-dropdown .no-results').waitFor();
  assert.equal(await pickers.locator('.ts-dropdown img').count(), 0);
  await pickers.keyboard.press('Escape');
  await pickers.locator('#copy').focus();
  assert.equal(pickers.url(), beforeSearch);

  await minuteSearch.focus();
  await pickers.keyboard.press('ArrowDown');
  await pickers.locator('.ts-dropdown.minute-picker').waitFor();
  await pickers.screenshot({ path: join(tmpdir(), 'meet-time-minute-picker.png'), fullPage: true });
  assert.deepEqual(await pickers.locator('.ts-dropdown.minute-picker [data-selectable]').evaluateAll(options => options.slice(0, 4).map(option => option.dataset.value)), ['00', '15', '30', '45']);
  await minuteSearch.fill('07');
  await pickers.locator('.ts-dropdown.minute-picker .active[data-value="07"]').waitFor();
  await pickers.keyboard.press('Enter');
  assert.equal(await pickers.locator('#minute').inputValue(), '07');
  assert.equal(new URLSearchParams(new URL(pickers.url()).hash.slice(1)).get('at'), '2026-07-15T19:07:00.000Z');

  // Hash navigation must refresh the displayed widgets, including aliases absent from the initial list.
  await pickers.evaluate(() => { location.hash = 'at=2026-07-15T14:35:00.000Z&tz=US%2FEastern&format=24'; });
  await pickers.waitForFunction(() => document.getElementById('timezone').tomselect.getValue() === 'US/Eastern');
  assert.equal(await pickers.locator('#minute').evaluate(select => select.tomselect.getValue()), '35');
  assert.equal(await pickers.locator('#timezone').inputValue(), 'US/Eastern');

  // Optional enhancement failure must leave usable native selects.
  const fallback = await newPage({ timezoneId: 'UTC', locale: 'en-US' });
  await fallback.route('**/vendor/**', route => route.abort());
  await fallback.goto(link);
  await fallback.locator('#copy:not([disabled])').waitFor();
  assert.equal(await fallback.locator('.ts-wrapper').count(), 0);
  await fallback.locator('#minute').selectOption('45');
  await fallback.locator('#timezone').selectOption('UTC');
  assert.equal(await fallback.locator('#local-time').innerText(), '3:45 PM');
  assert.equal(await fallback.locator('#minute optgroup').first().getAttribute('label'), 'Common');
  await fallback.context().close();
  await pickers.context().close();

  // Every hour must survive picker -> UTC link -> restored picker, especially noon/midnight.
  const clock = await newPage({ timezoneId: 'UTC', locale: 'en-US' });
  await clock.goto(base);
  await clock.locator('#copy:not([disabled])').waitFor();
  for (let hour = 0; hour < 24; hour++) {
    for (const hourFormat of ['24', '12']) {
      await setFields(clock, '2026-07-15', String(hour), '35', 'UTC', hourFormat);
      const expected = hourFormat === '12' ? `${hour % 12 || 12}:35 ${hour < 12 ? 'AM' : 'PM'}` : `${String(hour).padStart(2, '0')}:35`;
      assert.equal(await clock.locator('#local-time').innerText(), expected);
      const at = `2026-07-15T${String(hour).padStart(2, '0')}:35:00.000Z`;
      assert.equal(new URLSearchParams(new URL(clock.url()).hash.slice(1)).get('at'), at);
      await clock.locator('#hour-format').selectOption(hourFormat === '12' ? '24' : '12');
      assert.equal(new URLSearchParams(new URL(clock.url()).hash.slice(1)).get('at'), at);
      await clock.locator('#hour-format').selectOption(hourFormat);
      assert.equal(new URLSearchParams(new URL(clock.url()).hash.slice(1)).get('at'), at);
      await clock.reload();
      await clock.locator('#copy:not([disabled])').waitFor();
      assert.equal(await clock.locator('#hour-format').inputValue(), hourFormat);
      assert.equal(await clock.locator('#hour').inputValue(), String(hourFormat === '12' ? hour % 12 || 12 : hour));
      assert.equal(await clock.locator('#period').isVisible(), hourFormat === '12');
      assert.equal(await clock.locator('#local-time').innerText(), expected);
    }
  }
  for (const locale of ['en-GB', 'de-DE', 'es-ES', 'ar-EG', 'ja-JP']) {
    const localized = await newPage({ timezoneId: 'UTC', locale, viewport: { width: 375, height: 812 } });
    await localized.goto(base);
    await localized.locator('#copy:not([disabled])').waitFor();
    for (const hour of [0, 12, 21]) {
      await setFields(localized, '2026-07-15', String(hour), '35', 'UTC');
      const expected = await localized.evaluate(hour => {
        const formatter = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
        const date = new Date(Date.UTC(2026, 6, 15, hour, 35));
        return { text: formatter.format(date), period: formatter.formatToParts(date).find(part => part.type === 'dayPeriod').value };
      }, hour);
      assert.equal(await localized.locator('#local-time').textContent(), expected.text);
      assert.equal(await localized.locator('#period option:checked').textContent(), expected.period);
      assert.equal(await localized.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await localized.context().close();
  }
  await clock.context().close();

  await setFields(sender, '2026-03-08', '02', '30', 'America/New_York');
  assert.equal(await sender.locator('#error').isVisible(), true);
  assert.match(await sender.locator('#error').innerText(), /doesn't exist/);
  assert.equal(await sender.locator('#local-time').innerText(), '--:--');
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.equal(new URL(sender.url()).hash, '');
  assert.equal(await sender.locator('#share-url').inputValue(), '');
  await sender.locator('#hour-format').selectOption('24');
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.match(await sender.locator('#error').innerText(), /doesn't exist/);

  await setFields(sender, '2026-11-01', '01', '30', 'America/New_York');
  assert.equal(await sender.locator('#occurrence-field').isVisible(), true);
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.equal(await sender.locator('#occurrence').inputValue(), '');
  assert.equal(await sender.locator('label[for="occurrence"]').innerText(), 'Which time?');
  assert.equal(await sender.locator('#occurrence option').first().innerText(), 'Choose first or second');
  assert.match(await sender.locator('#occurrence option').nth(1).innerText(), /1:30 am/);
  const second = String(Date.parse('2026-11-01T06:30:00.000Z'));
  await sender.locator('#occurrence').selectOption(second);
  assert.equal(await sender.locator('#copy').isEnabled(), true);
  await sender.locator('#hour-format').selectOption('24');
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  assert.equal(await sender.locator('#copy').isEnabled(), true);
  assert.equal(new URLSearchParams(new URL(sender.url()).hash.slice(1)).get('at'), '2026-11-01T06:30:00.000Z');
  await sender.locator('#hour-format').selectOption('12');
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  const repeatedLink = await sender.locator('#share-url').inputValue();
  await sender.locator('#timezone').evaluate(select => select.tomselect.setValue('America/New_York'));
  assert.equal(sender.url(), repeatedLink);
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  await sender.locator('#timezone-ts-control').fill('nonsense');
  await sender.keyboard.press('Escape');
  await sender.locator('#copy').focus();
  assert.equal(sender.url(), repeatedLink);
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  await receiver.goto(repeatedLink);
  await receiver.locator('#copy:not([disabled])').waitFor();
  assert.equal(await receiver.locator('#occurrence').inputValue(), second);
  assert.equal(await receiver.locator('#share-url').inputValue(), repeatedLink);
  assert.equal(await receiver.locator('#error').isVisible(), false);

  await receiver.goto(base + '#at=garbage&tz=UTC');
  await receiver.locator('#error').waitFor();
  assert.equal(await receiver.locator('#copy').isDisabled(), true);
  await receiver.evaluate(hash => { location.hash = hash; }, new URL(link).hash);
  await receiver.locator('#copy:not([disabled])').waitFor();
  assert.equal(await receiver.locator('#local-time').innerText(), '7:30 AM');

  await receiver.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await receiver.locator('#copy').click();
  assert.equal(await receiver.locator('#copy-status').innerText(), "Couldn't copy the link. Copy the selected text manually.");
  assert.equal(await receiver.evaluate(() => document.activeElement.id), 'share-url');
  assert.equal(await receiver.evaluate(() => { const el = document.querySelector('#share-url'); return el.selectionEnd - el.selectionStart === el.value.length; }), true);
  assert.equal(await receiver.locator('#copy-fallback').isVisible(), true);
  await receiver.locator('#minute').evaluate(select => select.tomselect.setValue('31'));
  assert.equal(await receiver.locator('#copy-fallback').isVisible(), false);
  assert.equal(await receiver.locator('#copy-status').innerText(), '');
  await receiver.locator('#copy').click();
  assert.equal(await receiver.locator('#copy-fallback').isVisible(), true);
  assert.equal(await receiver.locator('#share-url').inputValue(), receiver.url());

  await sender.locator('#copy').click();
  await sender.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await sender.locator('#copy').click();
  await sender.waitForTimeout(3200);
  assert.equal(await sender.locator('#copy-fallback').isVisible(), true);
  assert.equal(await sender.locator('#copy-label').innerText(), 'Copy link');
  assert.match(await sender.locator('#copy-status').innerText(), /manually/);

  await sender.locator('#date').fill('');
  await sender.locator('#hour').focus();
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.match(await sender.locator('#error').innerText(), /valid date and time/);
  await sender.locator('#hour-format').selectOption('24');
  assert.equal(await sender.locator('#date').inputValue(), '');
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Passed: logo, responsive sizing, searchable/grouped pickers, native fallback, clock formats, locales, DST, shared links, and clipboard.');
  console.log(`Screenshots saved in ${tmpdir()}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
