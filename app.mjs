import { partsAt, possibleInstants, readSelection, selectionURL } from './time.mjs';

const $ = id => document.getElementById(id);
const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const zoneLabel = zone => zone.replaceAll('_', ' ').replaceAll('/', ' / ');
const format = (instant, timeZone, options) => new Intl.DateTimeFormat(undefined, {
  timeZone, hourCycle: $('hour-format').value === '12' ? 'h12' : 'h23', ...options,
}).format(new Date(instant));

function zoneDescription(instant, timeZone) {
  const offset = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant).find(part => part.type === 'timeZoneName').value;
  return `${zoneLabel(timeZone)} · ${offset}`;
}

function selectedHour() {
  const hour = Number($('hour').value);
  return $('period').hidden ? hour : hour % 12 + Number($('period').value);
}

function syncPicker(id) {
  const select = $(id);
  const picker = select.tomselect;
  if (!picker) return;
  picker.close();
  const value = select.value;
  // Replace dynamic lists; leave static groups intact when restoring a selection.
  if (id === 'hour' || id === 'occurrence') {
    picker.clearOptions(() => false);
    picker.addOptions([...select.options].filter(option => option.value)
      .map(option => ({ value: option.value, text: option.text })));
  }
  if (value && !picker.options[value]) {
    picker.addOption({ value, text: select.selectedOptions[0].text });
  }
  picker.isRequired = select.required;
  picker.setValue(value, true);
  picker.wrapper.hidden = select.hidden;
}

function setHour(hour) {
  const twelveHour = $('hour-format').value === '12';
  const numbers = new Intl.NumberFormat(undefined, { minimumIntegerDigits: twelveHour ? 1 : 2 });
  $('hour').replaceChildren(...Array.from({ length: twelveHour ? 12 : 24 }, (_, n) => {
    const value = n + (twelveHour ? 1 : 0);
    return new Option(numbers.format(value), String(value));
  }));
  $('hour').value = String(twelveHour ? hour % 12 || 12 : hour);
  $('period').value = hour < 12 ? '0' : '12';
  $('period').hidden = !twelveHour;
  $('period').required = twelveHour;
  syncPicker('hour');
  syncPicker('period');
}

let copyResetTimer;

function clearShareStatus() {
  clearTimeout(copyResetTimer);
  $('copy-label').textContent = 'Copy link';
  $('copy-status').textContent = '';
  $('copy-fallback').hidden = true;
}

function showError(message, clearURL = true) {
  $('error').textContent = message;
  $('error').hidden = false;
  $('local-time').textContent = '--:--';
  $('local-time').removeAttribute('datetime');
  $('local-date').textContent = 'Choose a valid time to create a link';
  $('local-zone').textContent = zoneLabel(viewerZone);
  $('share-url').value = '';
  $('copy').disabled = true;
  clearShareStatus();
  if (clearURL) history.replaceState(null, '', location.pathname + location.search);
}

function update(preferredInstant) {
  clearShareStatus();
  $('occurrence-field').hidden = true;
  $('occurrence').required = false;
  try {
    const date = $('date').value;
    const hour = selectedHour();
    const time = `${String(hour).padStart(2, '0')}:${$('minute').value}`;
    const timeZone = $('timezone').value;
    const instants = possibleInstants(date, time, timeZone);
    if (!instants.length) {
      throw new Error(`This time doesn't exist in ${zoneLabel(timeZone)} because the clocks go forward. Choose another time.`);
    }
    let instant = instants[0];
    if (instants.length > 1) {
      $('occurrence-field').hidden = false;
      $('occurrence').required = true;
      $('occurrence').replaceChildren(
        new Option('Choose first or second', ''),
        ...instants.map((at, i) => new Option(
          `${i === 0 ? 'First' : 'Second'} · ${format(at, timeZone, { hour: 'numeric', minute: '2-digit', timeZoneName: 'longOffset' })}`,
          String(at),
        )),
      );
      if (!instants.includes(preferredInstant)) {
        throw new Error('This time happens twice when the clocks go back. Choose the first or second time.');
      }
      instant = preferredInstant;
      $('occurrence').value = String(instant);
    }

    $('error').hidden = true;
    $('local-time').textContent = format(instant, viewerZone, { hour: 'numeric', minute: '2-digit' });
    $('local-time').dateTime = new Date(instant).toISOString();
    $('local-date').textContent = format(instant, viewerZone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('local-zone').textContent = zoneDescription(instant, viewerZone);
    const url = selectionURL(location.href, instant, timeZone, $('hour-format').value);
    history.replaceState(null, '', url);
    $('share-url').value = url;
    $('copy').disabled = false;
  } catch (error) {
    showError(error.message);
  } finally {
    syncPicker('occurrence');
  }
}

function load() {
  let selection;
  let linkError;
  try {
    selection = readSelection(location.hash);
  } catch (error) {
    linkError = error.message;
  }
  // Put the visitor's local time first when opening a shared link, including for screen readers.
  $('meeting').prepend(selection ? $('preview') : $('editor'));
  const timeZone = selection?.timeZone || viewerZone;
  // Start at the next quarter-hour, but allow sharing any minute.
  const instant = selection?.instant ?? (Math.floor(Date.now() / 900_000) + 1) * 900_000;
  const parts = partsAt(instant, timeZone);
  if (![...$('timezone').options].some(option => option.value === timeZone)) {
    $('timezone').add(new Option(zoneLabel(timeZone), timeZone));
  }
  $('date').value = parts.date;
  $('hour-format').value = selection?.hourFormat || '24';
  setHour(Number(parts.time.slice(0, 2)));
  $('minute').value = parts.time.slice(3, 5);
  $('timezone').value = timeZone;
  $('local-zone').textContent = zoneLabel(viewerZone);
  $('occurrence-field').hidden = true;
  for (const id of ['hour-format', 'minute', 'timezone']) syncPicker(id);
  $('occurrence').tomselect?.close();
  if (linkError) showError(linkError, false);
  else update(instant);
}

try {
  const numbers = new Intl.NumberFormat(undefined, { minimumIntegerDigits: 2 });
  const minutes = Array.from({ length: 60 }, (_, n) => n);
  $('minute').replaceChildren(...['Common', 'Other minutes'].map((label, i) => {
    const group = document.createElement('optgroup');
    group.label = label;
    group.append(...minutes.filter(n => i === 0 ? n % 15 === 0 : n % 15 !== 0)
      .map(n => new Option(numbers.format(n), String(n).padStart(2, '0'))));
    return group;
  }));
  const periods = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', hour: 'numeric', hourCycle: 'h12' });
  $('period').replaceChildren(...[0, 12].map(hour => new Option(
    periods.formatToParts(new Date(Date.UTC(2026, 0, 1, hour))).find(part => part.type === 'dayPeriod').value,
    String(hour),
  )));
  const zones = [...new Set([viewerZone, 'UTC', ...Intl.supportedValuesOf('timeZone')])];
  const groups = new Map();
  for (const zone of zones) {
    const label = zone === viewerZone ? 'Your timezone' : zone.split('/')[0];
    if (!groups.has(label)) {
      const group = document.createElement('optgroup');
      group.label = label;
      groups.set(label, group);
    }
    groups.get(label).append(new Option(zoneLabel(zone), zone));
  }
  $('timezone').replaceChildren(...groups.values());
  $('fields').disabled = false;
  load();
} catch {
  $('fields').disabled = true;
  showError("Couldn't load the timezone converter. Try the latest version of your browser.", false);
}

$('meeting-form').addEventListener('submit', event => event.preventDefault());
$('meeting-form').addEventListener('change', event => {
  // Search text is a draft, not a new meeting selection.
  if (!event.target.matches('select, input[type="date"]')) return;
  // Re-selecting a value or changing its display must preserve the chosen DST occurrence.
  const preferredInstant = event.target.id === 'occurrence'
    ? (event.target.value ? Number(event.target.value) : undefined)
    : Date.parse($('local-time').getAttribute('datetime'));
  if (event.target.id === 'hour-format') setHour(selectedHour());
  update(preferredInstant);
});
window.addEventListener('hashchange', load);
$('share-url').addEventListener('click', () => $('share-url').select());
$('copy').addEventListener('click', async () => {
  const url = $('share-url').value;
  if (!url) return;
  clearShareStatus();
  try {
    await navigator.clipboard.writeText(url);
    if ($('share-url').value === url) {
      clearShareStatus();
      $('copy-label').textContent = 'Copied!';
      copyResetTimer = setTimeout(clearShareStatus, 3000);
    }
  } catch {
    if ($('share-url').value !== url) return;
    $('copy-fallback').hidden = false;
    $('share-url').focus();
    $('share-url').select();
    $('copy-status').textContent = "Couldn't copy the link. Copy the selected text manually.";
  }
});

// Use the same picker for every dropdown, with native selects as a fallback.
if (window.TomSelect && !$('fields').disabled) {
  for (const select of $('fields').querySelectorAll('select')) {
    const id = select.id;
    const picker = new window.TomSelect(select, {
      create: false,
      maxOptions: null,
      refreshThrottle: 0,
      dropdownParent: 'body',
      copyClassesToDropdown: true,
      lockOptgroupOrder: true,
      searchField: ['text', 'value'],
      sortField: [{ field: '$order' }, { field: '$score' }],
      placeholder: { timezone: 'Search city or timezone', occurrence: 'Choose first or second' }[id] || 'Search',
      onDelete: () => false,
    });
    picker.control_input.setAttribute('aria-autocomplete', 'list');
    if (select.hasAttribute('aria-label')) picker.control_input.removeAttribute('aria-labelledby');
    if (select.hasAttribute('aria-describedby')) {
      picker.control_input.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));
    }
    select.setAttribute('aria-hidden', 'true');
    picker.wrapper.hidden = select.hidden;
  }
}
