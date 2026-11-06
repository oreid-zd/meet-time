import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = new URL('.', import.meta.url);
const assets = {
  'index.html': 'text/html', 'style.css': 'text/css', 'app.mjs': 'text/javascript', 'time.mjs': 'text/javascript', 'analytics.mjs': 'text/javascript',
  'llms.txt': 'text/plain', 'skills/meettime/SKILL.md': 'text/plain',
  '.well-known/agent-skills/index.json': 'application/json',
  'vendor/tom-select/tom-select.min.css': 'text/css',
  'vendor/tom-select/tom-select.base.min.js': 'text/javascript',
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!assets[file]) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': assets[file] });
  res.end(await readFile(new URL(file, root)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function newPage(options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
async function expandPreviews(page) {
  if (!await page.locator('#other-timezones').evaluate(element => element.open)) {
    await page.locator('#other-timezones > summary').click();
  }
}
async function choose(page, id, value) {
  await page.locator(`#${id}`).evaluate((select, value) => select.tomselect.setValue(value), value);
}
async function assertTimezoneOptionsMatch(page) {
  const options = await page.evaluate(() => ['timezone', 'preview-timezone'].map(id => {
    const picker = document.getElementById(id).tomselect;
    return Object.values(picker.options).map(option => ({
      value: option.value, text: option.text, group: option.optgroup, order: option.$order,
    }));
  }));
  assert.deepEqual(options[0], options[1], 'Timezone pickers must share labels, grouping, and order');
}
async function setFields(page, date, hour, minute, zone, hourFormat = '12') {
  await choose(page, 'hour-format', hourFormat);
  await page.locator('#date').fill(date);
  await choose(page, 'hour', String(hourFormat === '12' ? Number(hour) % 12 || 12 : Number(hour)));
  await choose(page, 'minute', minute);
  if (hourFormat === '12') await choose(page, 'period', Number(hour) < 12 ? '0' : '12');
  await choose(page, 'timezone', zone);
}
try {
  const sender = await newPage({ timezoneId: 'Europe/London', locale: 'en-GB', viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const indexResponse = await sender.request.get(new URL('.well-known/agent-skills/index.json', base).href);
  assert.equal(indexResponse.status(), 200);
  assert.equal(indexResponse.headers()['content-type'], 'application/json');
  const index = await indexResponse.json();
  assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  assert.equal(index.skills.length, 1);
  const entry = index.skills[0];
  assert.equal(entry.name, 'meettime');
  assert.equal(entry.type, 'skill-md');
  assert.equal(entry.url, '/skills/meettime/SKILL.md');
  const skillResponse = await sender.request.get(new URL(entry.url, indexResponse.url()).href);
  assert.equal(skillResponse.status(), 200);
  const skillBytes = await skillResponse.body();
  assert.equal(entry.digest, `sha256:${createHash('sha256').update(skillBytes).digest('hex')}`);
  const skill = skillBytes.toString('utf8');
  assert.ok(skill.startsWith(`---\nname: ${entry.name}\ndescription: ${entry.description}\n---\n`));
  const example = skill.match(/^https:\/\/meettime\.at\/#\S+$/m)[0];
  const overview = await sender.request.get(new URL('llms.txt', base).href);
  assert.equal(overview.status(), 200);
  assert.ok((await overview.text()).includes('https://meettime.at/skills/meettime/SKILL.md'));
  await sender.goto(base + new URL(example).hash);
  await sender.locator('#copy:not([disabled])').waitFor();
  assert.equal(await sender.locator('#local-time').innerText(), '15:30');
  assert.equal(await sender.locator('#date').inputValue(), '2026-07-15');
  assert.equal(await sender.locator('#timezone').inputValue(), 'Europe/London');
  assert.equal(await sender.locator('#local-time').getAttribute('datetime'), '2026-07-15T14:30:00.000Z');
  await sender.goto(base);
  await sender.locator('#copy:not([disabled])').waitFor();
  assert.equal(await sender.getByRole('link', { name: 'For AI agents', includeHidden: true }).count(), 0);
  assert.equal(await sender.locator('link[rel="describedby"]').getAttribute('href'), './llms.txt');
  assert.equal(await sender.locator('#timezone').inputValue(), 'Europe/London');
  assert.equal(await sender.locator('#meeting').getAttribute('aria-busy'), 'false');
  assert.equal(await sender.locator('#hour-format').inputValue(), '24');
  assert.equal(await sender.locator('#period-ts-control').isVisible(), false);
  assert.equal(await sender.locator('.ts-wrapper').count(), 7);
  for (const input of await sender.locator('.ts-control input').all()) {
    assert.equal(await input.evaluate(element => element.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true,
    }))), true, 'Dropdowns must not cancel native paste');
  }
  assert.equal(await sender.getByRole('combobox').count(), 4);
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
  assert.equal(new URL(link).pathname, '/');
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
  assert.equal(await receiver.evaluate(() => document.activeElement.tagName), 'SUMMARY');
  await receiver.keyboard.press('Tab');
  assert.equal(await receiver.evaluate(() => document.activeElement.id), 'hour-format-ts-control');
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
    await choose(mobile, 'hour-format', hourFormat);
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

  // The hour, period and format controls use the same searchable dropdown and keyboard actions.
  await pickers.getByRole('combobox', { name: 'Hour', exact: true }).fill('11');
  await pickers.locator('#hour-ts-dropdown .active[data-value="11"]').waitFor();
  await pickers.keyboard.press('Enter');
  assert.equal(await pickers.locator('#hour').inputValue(), '11');
  await pickers.getByRole('combobox', { name: 'AM or PM' }).fill('am');
  await pickers.locator('#period-ts-dropdown .active[data-value="0"]').waitFor();
  await pickers.keyboard.press('Enter');
  assert.equal(await pickers.locator('#period').inputValue(), '0');
  const beforeFormatChange = new URLSearchParams(new URL(pickers.url()).hash.slice(1)).get('at');
  await pickers.getByRole('combobox', { name: 'Time format' }).fill('24');
  await pickers.locator('#hour-format-ts-dropdown .active[data-value="24"]').waitFor();
  await pickers.keyboard.press('Enter');
  assert.equal(await pickers.locator('#hour-format').inputValue(), '24');
  assert.equal(await pickers.locator('#period-ts-control').isVisible(), false);
  assert.equal(new URLSearchParams(new URL(pickers.url()).hash.slice(1)).get('at'), beforeFormatChange);
  await setFields(pickers, '2026-07-15', '15', '30', 'Europe/London');

  const zoneSearch = pickers.getByRole('combobox', { name: 'Timezone', exact: true });
  const minuteSearch = pickers.getByRole('combobox', { name: 'Minute', exact: true });
  await pickers.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await pickers.evaluate(() => navigator.clipboard.writeText('New York'));
  await zoneSearch.focus();
  await pickers.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  assert.equal(await zoneSearch.inputValue(), 'New York');
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

  for (const viewport of [{ width: 640, height: 450 }, { width: 320, height: 400 }]) {
    const shortPage = await newPage({ viewport, deviceScaleFactor: 2 });
    for (const id of ['timezone', 'preview-timezone']) {
      await shortPage.goto(id === 'timezone' ? link : base);
      await shortPage.locator('#copy:not([disabled])').waitFor();
      if (id === 'preview-timezone') {
        await expandPreviews(shortPage);
        await shortPage.getByRole('combobox', { name: 'Add timezone', exact: true }).click();
      } else {
        await shortPage.getByRole('combobox', { name: 'Timezone', exact: true }).focus();
        await shortPage.keyboard.press('ArrowDown');
      }
      const dropdown = shortPage.locator(`#${id}-ts-dropdown`);
      await dropdown.waitFor();
      await shortPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const spacing = await dropdown.evaluate(element => ({
        gap: document.documentElement.scrollHeight - (element.getBoundingClientRect().bottom + scrollY),
        expected: 1.5 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      }));
      assert.ok(spacing.gap >= spacing.expected - 1, 'Dropdowns need bottom breathing room at high zoom');
      await shortPage.keyboard.press('Escape');
      await shortPage.locator(`#${id}-ts-dropdown`).waitFor({ state: 'hidden' });
      assert.equal(await shortPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await shortPage.context().close();
  }

  // Hash navigation must refresh the displayed widgets, including aliases absent from the initial list.
  await pickers.evaluate(() => { location.hash = 'at=2026-07-15T14:35:00.000Z&tz=US%2FEastern&format=24'; });
  await pickers.waitForFunction(() => document.getElementById('timezone').tomselect.getValue() === 'US/Eastern');
  assert.equal(await pickers.locator('#minute').evaluate(select => select.tomselect.getValue()), '35');
  assert.equal(await pickers.locator('#timezone').inputValue(), 'US/Eastern');
  assert.equal(await pickers.locator('#hour-format').evaluate(select => select.tomselect.getValue()), '24');
  assert.equal(await pickers.locator('#hour').evaluate(select => select.tomselect.getValue()), '10');
  assert.equal(await pickers.locator('#period-ts-control').isVisible(), false);

  await assertTimezoneOptionsMatch(pickers);
  assert.equal(await pickers.locator('#preview-timezone').evaluate(select => Boolean(select.tomselect.options['US/Eastern'])), true);

  const aligned = await newPage({ timezoneId: 'Europe/London', locale: 'en-GB' });
  await aligned.goto(base + '#at=2026-07-15T14%3A30%3A00.000Z&tz=UTC&format=24');
  await aligned.locator('#copy:not([disabled])').waitFor();
  await assertTimezoneOptionsMatch(aligned);
  await expandPreviews(aligned);
  const controlHeights = await aligned.evaluate(() => ['timezone', 'preview-timezone'].map(id =>
    document.getElementById(id).tomselect.control.getBoundingClientRect().height));
  assert.equal(controlHeights[0], controlHeights[1]);
  for (const id of ['timezone', 'preview-timezone']) {
    const input = aligned.locator(`#${id}-ts-control`);
    const dropdown = aligned.locator(`#${id}-ts-dropdown`);
    await input.focus();
    assert.equal(await dropdown.isVisible(), false, 'Focus must not open a timezone picker');
    await aligned.keyboard.press('ArrowDown');
    await dropdown.waitFor();
    await aligned.keyboard.press('Escape');
    await dropdown.waitFor({ state: 'hidden' });
    await input.locator('..').click();
    await dropdown.waitFor();
    await input.fill('Tokyo');
    await aligned.locator(`#${id}-ts-dropdown .active[data-value="Asia/Tokyo"]`).waitFor();
    await aligned.keyboard.press('Enter');
    assert.equal(await aligned.locator(`#${id}`).inputValue(), 'Asia/Tokyo');
    if (id === 'timezone') {
      assert.equal(new URLSearchParams(new URL(aligned.url()).hash.slice(1)).get('tz'), 'Asia/Tokyo');
    } else {
      assert.equal(await aligned.locator('#timezone-previews li').count(), 0);
      assert.equal(new URLSearchParams(new URL(aligned.url()).hash.slice(1)).has('preview'), false);
      await aligned.locator('#add-timezone').click();
      assert.equal(await aligned.locator('#timezone-previews li').count(), 1);
    }
    await assertTimezoneOptionsMatch(aligned);
  }
  await aligned.context().close();

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
  await fallback.locator('#hour').selectOption('11');
  await fallback.locator('#period').selectOption('0');
  await fallback.locator('#hour-format').selectOption('24');
  assert.equal(await fallback.locator('#local-time').innerText(), '11:45');

  await expandPreviews(fallback);
  await fallback.locator('#add-timezone').click();
  assert.match(await fallback.locator('#preview-status').innerText(), /Choose a timezone/);
  assert.equal(await fallback.locator('#preview-add-form').isVisible(), true);
  await fallback.locator('#preview-timezone optgroup').first().waitFor({ state: 'attached' });
  await fallback.locator('#preview-timezone').selectOption('Asia/Tokyo');
  assert.equal(await fallback.locator('#timezone-previews li').count(), 0);
  await fallback.locator('#add-timezone').click();
  assert.equal(await fallback.locator('#timezone-previews li').count(), 1);
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
      await choose(clock, 'hour-format', hourFormat === '12' ? '24' : '12');
      assert.equal(new URLSearchParams(new URL(clock.url()).hash.slice(1)).get('at'), at);
      await choose(clock, 'hour-format', hourFormat);
      assert.equal(new URLSearchParams(new URL(clock.url()).hash.slice(1)).get('at'), at);
      await clock.reload();
      await clock.locator('#copy:not([disabled])').waitFor();
      assert.equal(await clock.locator('#hour-format').inputValue(), hourFormat);
      assert.equal(await clock.locator('#hour').inputValue(), String(hourFormat === '12' ? hour % 12 || 12 : hour));
      assert.equal(await clock.locator('#period-ts-control').isVisible(), hourFormat === '12');
      assert.deepEqual(await clock.locator('#hour').evaluate(select => Object.keys(select.tomselect.options).sort()),
        Array.from({ length: hourFormat === '12' ? 12 : 24 }, (_, n) => String(n + (hourFormat === '12' ? 1 : 0))).sort());
      assert.equal(await clock.locator('#hour').evaluate(select => select.tomselect.getValue()), String(hourFormat === '12' ? hour % 12 || 12 : hour));
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
  await choose(sender, 'hour-format', '24');
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.match(await sender.locator('#error').innerText(), /doesn't exist/);

  await setFields(sender, '2026-11-01', '01', '30', 'America/New_York');
  assert.equal(await sender.locator('#occurrence-field').isVisible(), true);
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.equal(await sender.locator('#occurrence').inputValue(), '');
  assert.equal(await sender.locator('label[for="occurrence-ts-control"]').innerText(), 'Which time?');
  assert.equal(await sender.getByRole('combobox', { name: 'Which time?' }).getAttribute('aria-describedby'), 'occurrence-hint');
  assert.equal(await sender.locator('#occurrence option').first().innerText(), 'Choose first or second');
  assert.match(await sender.locator('#occurrence option').nth(1).innerText(), /1:30 am/);
  const second = String(Date.parse('2026-11-01T06:30:00.000Z'));
  await sender.getByRole('combobox', { name: 'Which time?' }).fill('Second');
  await sender.locator(`#occurrence-ts-dropdown .active[data-value="${second}"]`).waitFor();
  await sender.keyboard.press('Enter');
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  assert.equal(await sender.locator('#copy').isEnabled(), true);
  await choose(sender, 'hour-format', '24');
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  assert.match(await sender.locator('#occurrence').evaluate(select => select.tomselect.options[select.value].text), /01:30/);
  assert.equal(await sender.locator('#copy').isEnabled(), true);
  assert.equal(new URLSearchParams(new URL(sender.url()).hash.slice(1)).get('at'), '2026-11-01T06:30:00.000Z');
  await choose(sender, 'hour-format', '12');
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  const repeatedLink = await sender.locator('#share-url').inputValue();
  await choose(sender, 'timezone', 'America/New_York');
  assert.equal(sender.url(), repeatedLink);
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  await sender.locator('#timezone-ts-control').fill('nonsense');
  await sender.keyboard.press('Escape');
  await sender.locator('#copy').focus();
  assert.equal(sender.url(), repeatedLink);
  assert.equal(await sender.locator('#occurrence').inputValue(), second);
  await sender.locator('#date').fill('2027-11-07');
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.equal(await sender.locator('#occurrence').evaluate(select => select.tomselect.getValue()), '');
  assert.deepEqual(await sender.locator('#occurrence').evaluate(select => Object.keys(select.tomselect.options).sort()),
    ['2027-11-07T05:30:00.000Z', '2027-11-07T06:30:00.000Z'].map(value => String(Date.parse(value))).sort());
  await sender.goto(repeatedLink);
  await sender.locator('#copy:not([disabled])').waitFor();
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
  await choose(receiver, 'minute', '31');
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
  await sender.getByRole('combobox', { name: 'Hour', exact: true }).focus();
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  assert.match(await sender.locator('#error').innerText(), /valid date and time/);
  await choose(sender, 'hour-format', '24');
  assert.equal(await sender.locator('#date').inputValue(), '');
  assert.equal(await sender.locator('#copy').isDisabled(), true);
  const previews = await newPage({ timezoneId: 'UTC', locale: 'en-GB', viewport: { width: 375, height: 812 } });
  const storageKey = 'meettime.preview-timezones';
  await previews.addInitScript(() => {
    window.storageWrites = 0;
    for (const name of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[name];
      Storage.prototype[name] = function (...args) {
        window.storageWrites++;
        return original.apply(this, args);
      };
    }
  });
  const savedZones = () => previews.evaluate(key => localStorage.getItem(key), storageKey);
  const previewTimes = () => previews.locator('#timezone-previews time').allTextContents();
  async function addPreview(zone) {
    await expandPreviews(previews);
    await previews.waitForFunction(() => Boolean(document.getElementById('preview-timezone').tomselect));
    await choose(previews, 'preview-timezone', zone);
    await previews.locator('#add-timezone').click();
  }
  await previews.goto(base);
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.equal(await previews.locator('#other-timezones').isVisible(), true);
  assert.equal(await previews.getByRole('tab').count(), 0);
  assert.equal(await previews.locator('#result').isVisible(), true);
  assert.equal(await previews.locator('#other-timezones').evaluate(el => el.open), false);
  assert.equal(await previews.locator('#preview-add-form').isVisible(), false);
  assert.equal(await previews.locator('#preview-timezone-ts-dropdown').isVisible(), false);
  const untouchedLink = previews.url();
  assert.equal(await previews.evaluate(() => window.storageWrites), 0);
  await previews.locator('#other-timezones > summary').focus();
  await previews.keyboard.press('Space');
  assert.equal(await previews.locator('#preview-add-form').isVisible(), true);
  assert.equal(await previews.locator('#local-time').isVisible(), true);
  await previews.keyboard.press('Space');
  assert.equal(await previews.locator('#preview-add-form').isVisible(), false);
  await expandPreviews(previews);
  const emptySearch = previews.getByRole('combobox', { name: 'Add timezone', exact: true });
  assert.equal(await emptySearch.getAttribute('aria-expanded'), 'false');
  for (let attempt = 0; attempt < 2; attempt++) {
    await previews.locator('#add-timezone').click();
    assert.equal(await previews.locator('#preview-add-form').isVisible(), true);
    assert.equal(await emptySearch.getAttribute('aria-expanded'), 'false');
    assert.equal(await emptySearch.getAttribute('aria-invalid'), 'true');
    assert.match(await previews.locator('#preview-status').innerText(), /Choose a timezone/);
    assert.equal(await previews.evaluate(() => document.activeElement.id), 'preview-timezone-ts-control');
  }
  await emptySearch.click();
  await previews.locator('#preview-timezone-ts-dropdown').waitFor();
  await emptySearch.fill('Tokyo');
  await previews.locator('#add-timezone').click();
  assert.match(await previews.locator('#preview-status').innerText(), /Choose a timezone/);
  assert.equal(await previews.locator('#preview-timezone').inputValue(), '');
  assert.equal(await emptySearch.getAttribute('aria-expanded'), 'false');
  await emptySearch.click();
  await emptySearch.fill('Tokyo');
  await previews.locator('#preview-timezone-ts-dropdown .active[data-value="Asia/Tokyo"]').waitFor();
  await previews.keyboard.press('Enter');
  assert.equal(await emptySearch.getAttribute('aria-expanded'), 'false');
  assert.equal(await emptySearch.getAttribute('aria-invalid'), 'false');
  assert.equal(await previews.locator('#timezone-previews li').count(), 0);
  assert.equal(await previews.evaluate(() => window.storageWrites), 0);
  assert.equal(previews.url(), untouchedLink);

  await setFields(previews, '2026-07-15', '23', '30', 'UTC', '24');
  const prominentTimeSize = await previews.locator('#local-time').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  assert.equal((await previews.locator('#local-time').boundingBox()).x, (await previews.locator('#local-zone').boundingBox()).x);
  await addPreview('Asia/Tokyo');
  await addPreview('America/Los_Angeles');
  assert.deepEqual(await previewTimes(), ['8:30', '16:30']);
  assert.equal(await previews.locator('#result').isVisible(), true);
  assert.equal(await previews.locator('#local-time').innerText(), '23:30');
  assert.match(await previews.locator('#local-date').innerText(), /Wednesday, 15 July 2026/);
  assert.equal(await previews.locator('#preview-count').textContent(), ' · 2');
  const localRow = await previews.locator('#result').boundingBox();
  const firstComparison = await previews.locator('#timezone-previews li').first().boundingBox();
  assert.ok(localRow.y + localRow.height <= firstComparison.y);
  assert.equal(await previews.locator('#local-time').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), prominentTimeSize);
  const writesBeforeDuplicate = await previews.evaluate(() => window.storageWrites);
  await addPreview('Asia/Tokyo');
  assert.equal(await previews.locator('#timezone-previews li').count(), 2);
  assert.equal(await previews.evaluate(() => window.storageWrites), writesBeforeDuplicate);
  assert.match(await previews.locator('#preview-status').innerText(), /already/);
  assert.match(await previews.locator('.preview-date').first().innerText(), /Thu, 16 Jul 2026/);
  assert.match(await previews.locator('#timezone-previews .local-zone').first().innerText(), /GMT\+09:00/);
  assert.deepEqual(JSON.parse(await savedZones()), ['Asia/Tokyo', 'America/Los_Angeles']);
  const previewLink = await previews.locator('#share-url').inputValue();
  assert.deepEqual(new URLSearchParams(new URL(previewLink).hash.slice(1)).getAll('preview'), ['Asia/Tokyo', 'America/Los_Angeles']);
  assert.equal(await previews.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await choose(previews, 'preview-timezone', '');
  await emptySearch.click();
  await previews.locator('#preview-timezone-ts-dropdown').waitFor();
  await previews.locator('#other-timezones > summary').click();
  await previews.locator('#preview-timezone-ts-dropdown').waitFor({ state: 'hidden' });
  assert.equal(await previews.locator('#preview-add-form').isVisible(), false);
  assert.equal(await previews.locator('#local-time').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), prominentTimeSize);
  await expandPreviews(previews);
  assert.equal(await previews.locator('#preview-timezone-ts-dropdown').isVisible(), false);
  await previews.screenshot({ path: join(tmpdir(), 'meet-time-previews-mobile.png'), fullPage: true });
  const previewDesktop = await newPage({ timezoneId: 'UTC', locale: 'en-GB', viewport: { width: 1280, height: 1200 } });
  await previewDesktop.goto(previewLink);
  await previewDesktop.locator('#copy:not([disabled])').waitFor();
  assert.equal(await previewDesktop.locator('#preview-add-form').isVisible(), false);
  await expandPreviews(previewDesktop);
  await previewDesktop.screenshot({ path: join(tmpdir(), 'meet-time-previews-desktop.png'), fullPage: true });
  await previewDesktop.context().close();
  await previews.setViewportSize({ width: 320, height: 812 });
  assert.equal(await previews.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await previews.goto(base);
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.equal(await previews.locator('#other-timezones').isVisible(), true);
  assert.equal(await previews.locator('#timezone-previews li').count(), 2);
  assert.equal(await previews.evaluate(() => window.storageWrites), 0);
  await previews.goto(link);
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.equal(await previews.locator('#timezone-previews li').count(), 0);
  await choose(previews, 'minute', '45');
  await previews.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
  await previews.locator('#copy').click();
  assert.equal(await previews.evaluate(() => window.storageWrites), 0);
  assert.deepEqual(JSON.parse(await savedZones()), ['Asia/Tokyo', 'America/Los_Angeles']);
  await previews.evaluate(hash => { location.hash = hash; }, new URL(previewLink).hash);
  await previews.locator('#timezone-previews li').first().waitFor({ state: 'attached' });
  assert.equal(await previews.locator('#other-timezones').evaluate(el => el.open), false);
  await expandPreviews(previews);
  assert.equal(await previews.locator('#other-timezones').isVisible(), true);
  assert.equal(await previews.evaluate(() => window.storageWrites), 0);
  await choose(previews, 'hour-format', '12');
  assert.deepEqual(await previewTimes(), ['8:30 am', '4:30 pm']);
  assert.equal(await previews.evaluate(() => window.storageWrites), 0);
  await previews.getByRole('button', { name: 'Remove Asia / Tokyo', exact: true }).click();
  assert.deepEqual(JSON.parse(await savedZones()), ['America/Los_Angeles']);
  assert.equal(await previews.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Remove America / Los Angeles');
  await previews.evaluate(() => localStorage.setItem('unrelated', 'keep'));
  await previews.getByRole('button', { name: 'Reset timezones', exact: true }).click();
  assert.equal(await savedZones(), null);
  assert.equal(await previews.evaluate(() => localStorage.getItem('unrelated')), 'keep');
  assert.equal(await previews.locator('#timezone-previews li').count(), 0);
  assert.equal(await previews.locator('#local-time').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), prominentTimeSize);
  assert.equal(await previews.locator('#local-time').isVisible(), true);
  assert.equal(new URL(previews.url()).hash.includes('preview='), false);
  assert.equal(new URLSearchParams(new URL(previews.url()).hash.slice(1)).get('at'), '2026-07-15T23:30:00.000Z');
  await previews.evaluate(key => localStorage.setItem(key, '{broken'), storageKey);
  await previews.goto(base);
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.equal(await previews.locator('#timezone-previews li').count(), 0);
  const multiExample = skill.match(/^https:\/\/meettime\.at\/#\S+$/gm)[1];
  assert.ok(multiExample, 'Agent skill must include a multi-timezone example');
  await previews.goto(base + new URL(multiExample).hash);
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.deepEqual(await previewTimes(), ['10:30', '23:30']);
  assert.equal(await previews.evaluate(() => window.storageWrites), 0);
  await previews.goto(link + '&preview=Not%2FA_Zone');
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.equal(await previews.locator('#other-timezones').isVisible(), true);
  await expandPreviews(previews);
  assert.match(await previews.locator('#preview-status').innerText(), /omitted/);
  assert.equal(await previews.evaluate(() => window.storageWrites), 0);
  await previews.goto(previewLink + '&preview=Not%2FA_Zone&preview=US%2FPacific');
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.equal(await previews.locator('#timezone-previews li').count(), 2);
  await expandPreviews(previews);
  assert.match(await previews.locator('#preview-status').innerText(), /omitted/);
  await previews.goto(repeatedLink + '&preview=UTC');
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.deepEqual(await previewTimes(), ['6:30 am']);
  await addPreview('Asia/Katmandu');
  assert.deepEqual(await previewTimes(), ['6:30 am', '12:15 pm']);
  assert.equal(new URLSearchParams(new URL(previews.url()).hash.slice(1)).get('at'), '2026-11-01T06:30:00.000Z');
  await previews.goto(base + '#at=2026-03-08T07%3A30%3A00.000Z&tz=UTC&format=24&preview=America%2FNew_York');
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.deepEqual(await previewTimes(), ['3:30']);
  await expandPreviews(previews);
  assert.match(await previews.locator('#timezone-previews .local-zone').innerText(), /GMT-04:00/);
  const limitHash = new URL(previewLink);
  for (const zone of Intl.supportedValuesOf('timeZone').slice(0, 20)) limitHash.hash += '&preview=' + encodeURIComponent(zone);
  await previews.goto(limitHash.href);
  await previews.locator('#copy:not([disabled])').waitFor();
  assert.equal(await previews.locator('#timezone-previews li').count(), 10);
  assert.equal(await previews.locator('#other-timezones').isVisible(), true);
  await previews.setViewportSize({ width: 375, height: 812 });
  assert.equal(await previews.locator('#result').isVisible(), true);
  assert.equal(await previews.locator('#local-time').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), prominentTimeSize);
  assert.equal(await previews.locator('#other-timezones').evaluate(el => el.open), false);
  await expandPreviews(previews);
  assert.equal(await previews.locator('#add-timezone').isDisabled(), true);
  assert.equal(await previews.locator('#preview-timezone').isDisabled(), true);
  await previews.locator('#timezone-previews button').last().click();
  assert.equal(await previews.locator('#preview-timezone').isDisabled(), false);
  await previews.context().close();

  const noStorage = await newPage({ timezoneId: 'UTC', locale: 'en-GB' });
  await noStorage.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await noStorage.goto(base);
  await noStorage.locator('#copy:not([disabled])').waitFor();
  await expandPreviews(noStorage);
  await noStorage.waitForFunction(() => Boolean(document.getElementById('preview-timezone').tomselect));
  await choose(noStorage, 'preview-timezone', 'Asia/Tokyo');
  await noStorage.locator('#add-timezone').click();
  assert.equal(await noStorage.locator('#timezone-previews li').count(), 1);
  assert.match(await noStorage.locator('#preview-status').innerText(), /couldn't save/);
  assert.equal(await noStorage.locator('#copy').isEnabled(), true);
  await noStorage.getByRole('button', { name: 'Reset timezones', exact: true }).click();
  assert.equal(await noStorage.locator('#timezone-previews li').count(), 0);
  await noStorage.context().close();

  const analytics = await newPage({ timezoneId: 'UTC', locale: 'en-US' });
  await analytics.route(/^https?:\/\/(meettime\.at|localhost|127\.0\.0\.1|\[::1\]|example\.com)(:\d+)?\//, async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await analytics.request.get(base + url.pathname.slice(1)) });
  });
  await analytics.route('https://*.posthog.com/**', route => {
    errors.push('Unexpected direct PostHog request: ' + route.request().url());
    return route.abort();
  });
  await analytics.route('https://e.meettime.at/**', route => {
    if (!route.request().url().endsWith('/static/array.js')) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: `
      window.analyticsEvents = [];
      window.posthog = {
        init(token, config) {
          window.analyticsConfig = { ...config, token };
          window.filterEvent = config.before_send;
          window.startAnalytics = () => config.loaded(this);
          if (location.search !== '?defer') window.startAnalytics();
        },
        capture(event, properties = {}) {
          if (window.failAnalytics) throw new Error('Analytics unavailable');
          const result = window.filterEvent({ event, properties: {
            distinct_id: 'anonymous', $session_id: 'session', $browser: 'Chrome',
            $current_url: location.href, $referrer: 'https://example.com/private?secret=yes',
            $session_entry_url: location.href, $initial_current_url: location.href,
            $set: { timezone: 'Europe/London' }, $set_once: { url: location.href },
            meeting_date: '2026-07-15', timezone: 'unexpected-timezone',
            entry_type: 'unexpected-entry', different_timezone: 'unexpected-zone', environment: 'wrong', ...properties,
          } });
          if (result) window.analyticsEvents.push(result);
        },
      };
    ` });
  });
  await analytics.goto('https://meettime.at/?private=secret' + new URL(link).hash, { referer: 'https://example.com/private?secret=yes' });
  await analytics.locator('#copy:not([disabled])').waitFor();
  await analytics.waitForFunction(() => window.analyticsEvents?.length === 2);
  assert.deepEqual(await analytics.evaluate(() => window.analyticsEvents.map(event => event.event)), ['$pageview', 'shared_link_opened']);
  const config = await analytics.evaluate(() => window.analyticsConfig);
  assert.equal(config.token, 'phc_unb7fV3zLmVUAKCJW7DDwK4BpvKoaqxwicpnhLh8ijpw');
  assert.equal(config.api_host, 'https://e.meettime.at');
  assert.equal(config.ui_host, 'https://us.posthog.com');
  assert.equal(await analytics.locator('script[src="https://e.meettime.at/static/array.js"]').count(), 1);
  for (const key of ['autocapture', 'capture_pageview', 'capture_pageleave']) assert.equal(config[key], false);
  for (const key of ['disable_persistence', 'disable_session_recording', 'disable_surveys', 'advanced_disable_flags', 'respect_dnt']) assert.equal(config[key], true);
  assert.equal(config.person_profiles, 'never');
  assert.deepEqual(await analytics.evaluate(() => window.analyticsEvents[0].properties), {
    distinct_id: 'anonymous', $session_id: 'session', $browser: 'Chrome', $geoip_disable: true,
    $current_url: 'https://meettime.at/', $host: 'meettime.at', $pathname: '/',
    entry_type: 'shared', environment: 'production',
    $referrer: 'https://example.com', $referring_domain: 'example.com',
  });
  assert.equal(await analytics.evaluate(() => window.analyticsEvents[1].properties.different_timezone), true);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents[1].properties.entry_type), undefined);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents[1].properties.timezone), undefined);
  assert.equal(await analytics.evaluate(() => window.filterEvent({ event: '$autocapture', properties: {} })), null);
  await choose(analytics, 'minute', '45');
  await analytics.evaluate(hash => { location.hash = hash; }, new URL(link).hash);
  await analytics.waitForFunction(() => document.getElementById('minute').value === '30');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.length), 2);
  await analytics.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise(resolve => { window.finishCopy = resolve; }),
  } }));
  await analytics.locator('#copy').click();
  await analytics.waitForFunction(() => typeof window.finishCopy === 'function');
  await choose(analytics, 'timezone', 'Asia/Tokyo');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.length), 2);
  await analytics.evaluate(() => window.finishCopy());
  await analytics.waitForFunction(() => window.analyticsEvents.length === 3);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).event), 'link_copied');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.timezone), 'Europe/London');
  await analytics.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
  await analytics.locator('#copy').click();
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.timezone), 'Asia/Tokyo');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.entry_type), undefined);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.different_timezone), undefined);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.meeting_date), undefined);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.$set), undefined);
  await analytics.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await analytics.locator('#copy').click();
  assert.deepEqual(await analytics.evaluate(() => window.analyticsEvents.map(event => event.event)), ['$pageview', 'shared_link_opened', 'link_copied', 'link_copied', 'copy_failed']);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.timezone), undefined);
  assert.equal(await analytics.locator('#copy-fallback').isVisible(), true);
  await analytics.evaluate(() => {
    window.failAnalytics = true;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
  });
  await analytics.locator('#copy').click();
  assert.equal(await analytics.locator('#copy-label').innerText(), 'Copied!');
  assert.equal(await analytics.locator('#copy-fallback').isVisible(), false);
  await analytics.goto('https://meettime.at/?defer');
  await analytics.locator('#copy:not([disabled])').waitFor();
  await analytics.waitForFunction(() => typeof window.startAnalytics === 'function');
  await choose(analytics, 'timezone', 'Asia/Tokyo');
  await analytics.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
  await analytics.locator('#copy').click();
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.length), 0);
  await analytics.evaluate(() => window.startAnalytics());
  assert.deepEqual(await analytics.evaluate(() => window.analyticsEvents.map(event => event.event)), ['$pageview', 'link_copied']);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.timezone), 'Asia/Tokyo');
  for (const hash of ['', '#at=garbage&tz=UTC']) {
    await analytics.goto('about:blank');
    await analytics.goto('https://meettime.at/' + hash);
    await analytics.waitForFunction(() => window.analyticsEvents?.length === 1);
    assert.equal(await analytics.evaluate(() => window.analyticsEvents[0].event), '$pageview');
    assert.equal(await analytics.evaluate(() => window.analyticsEvents[0].properties.entry_type), hash ? 'invalid' : 'new');
  }
  for (const zone of ['UTC', 'Etc/UTC', 'Asia/Tokyo']) {
    const hash = new URLSearchParams({ at: '2026-07-15T14:30:00.000Z', tz: zone });
    await analytics.goto('about:blank');
    await analytics.goto('https://meettime.at/#' + hash);
    await analytics.waitForFunction(() => window.analyticsEvents?.length === 2);
    assert.equal(await analytics.evaluate(() => window.analyticsEvents[1].properties.different_timezone), zone === 'Asia/Tokyo');
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    await analytics.goto(`http://${host}:8000/`);
    await analytics.locator('#copy:not([disabled])').waitFor();
    assert.equal(await analytics.locator('script[src*="e.meettime.at"]').count(), 0);
    await analytics.goto(`http://${host}:8000/?analytics=1`);
    await analytics.waitForFunction(() => window.analyticsEvents?.length === 1);
    assert.equal(await analytics.evaluate(() => window.analyticsEvents[0].properties.environment), 'development');
    assert.equal(await analytics.evaluate(() => window.analyticsEvents[0].properties.entry_type), 'new');
    assert.equal(await analytics.evaluate(() => window.analyticsEvents[0].properties.$current_url), `http://${host}:8000/`);
  }
  await choose(analytics, 'timezone', 'Asia/Tokyo');
  await analytics.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
  await analytics.locator('#copy').click();
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.timezone), 'Asia/Tokyo');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.environment), 'development');
  const localLink = await analytics.locator('#share-url').inputValue();
  await analytics.goto('about:blank');
  await analytics.goto(localLink);
  await analytics.waitForFunction(() => window.analyticsEvents?.length === 2);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents[0].properties.entry_type), 'shared');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents[1].properties.different_timezone), true);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents[1].properties.environment), 'development');
  await analytics.goto('https://example.com/?analytics=1');
  await analytics.locator('#copy:not([disabled])').waitFor();
  assert.equal(await analytics.locator('script[src*="e.meettime.at"]').count(), 0);
  await analytics.goto('https://meettime.at/' + new URL(previewLink).hash);
  await analytics.locator('#copy:not([disabled])').waitFor();
  await analytics.waitForFunction(() => window.analyticsEvents?.length === 2);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents[1].properties.preview_count), 2);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.some(event => event.event === 'timezone_preview_opened')), false);
  await expandPreviews(analytics);
  await analytics.waitForFunction(() => window.analyticsEvents.at(-1).event === 'timezone_preview_opened');
  assert.equal(await analytics.locator('#preview-timezone-ts-dropdown').isVisible(), false);
  assert.deepEqual(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.source), 'link');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).event), 'timezone_preview_opened');
  await analytics.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise(resolve => { window.finishPreviewCopy = resolve; }),
  } }));
  await analytics.locator('#copy').click();
  await analytics.waitForFunction(() => typeof window.finishPreviewCopy === 'function');
  await analytics.getByRole('button', { name: 'Reset timezones', exact: true }).click();
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.action), 'reset');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.preview_count), 0);
  await analytics.evaluate(() => window.finishPreviewCopy());
  await analytics.waitForFunction(() => window.analyticsEvents.at(-1).event === 'link_copied');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.preview_count), 2);
  const eventsBeforeAdd = await analytics.evaluate(() => window.analyticsEvents.length);
  await analytics.locator('#add-timezone').click();
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.length), eventsBeforeAdd);
  await choose(analytics, 'preview-timezone', 'Asia/Tokyo');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.length), eventsBeforeAdd);
  await analytics.locator('#add-timezone').click();
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.length), eventsBeforeAdd + 1);
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.action), 'add');
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.preview_count), 1);
  await analytics.getByRole('button', { name: 'Remove Asia / Tokyo', exact: true }).click();
  assert.equal(await analytics.evaluate(() => window.analyticsEvents.at(-1).properties.action), 'remove');
  assert.equal(await analytics.evaluate(() => window.filterEvent({ event: 'timezone_preview_changed', properties: {
    action: 'add', preview_count: 1, preview_timezones: ['Asia/Tokyo'], search: 'Tokyo', meeting_date: 'secret', source: 'secret',
  } }).properties.preview_timezones), undefined);
  assert.equal(await analytics.evaluate(() => window.filterEvent({ event: 'timezone_preview_changed', properties: { search: 'Tokyo' } }).properties.search), undefined);
  await analytics.route('https://e.meettime.at/**', route => route.abort());
  await analytics.goto('https://meettime.at/' + new URL(link).hash);
  await analytics.locator('#copy:not([disabled])').waitFor();
  await analytics.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
  await analytics.locator('#copy').click();
  assert.equal(await analytics.locator('#copy-label').innerText(), 'Copied!');
  await analytics.addInitScript(() => {
    const params = new URLSearchParams(location.search);
    Object.defineProperty(navigator, 'doNotTrack', { value: params.has('dnt') ? '1' : null });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: params.has('gpc') });
  });
  for (const origin of ['https://meettime.at/?', base + '?analytics=1&']) {
    for (const signal of ['dnt', 'gpc']) {
      await analytics.goto(origin + signal);
      await analytics.locator('#copy:not([disabled])').waitFor();
      assert.equal(await analytics.locator('script[src*="e.meettime.at"]').count(), 0);
    }
  }
  assert.equal(await sender.locator('script[src*="e.meettime.at"]').count(), 0);
  await analytics.context().close();
  assert.deepEqual(errors, []);
  console.log('Passed: timezone previews, manual-only preferences, reset, blocked storage, preview analytics/privacy, agent multi-zone links, analytics events/privacy and blocked SDK, skill discovery/checksum and example link, consistent dropdowns, dynamic hour/DST options, responsive sizing, search, native fallback, clock formats, locales, shared links, and clipboard.');
  console.log(`Screenshots saved in ${tmpdir()}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
