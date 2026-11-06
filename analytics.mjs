import { readSelection } from './time.mjs';

const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const enabled = (location.hostname === 'meettime.at'
  || local && new URLSearchParams(location.search).get('analytics') === '1')
  && navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl;
const pending = [];
let client;

export function track(event, properties = {}) {
  if (!enabled) return;
  try {
    if (client) client.capture(event, properties);
    else pending.push([event, properties]);
  } catch {
    // Analytics failures must not interrupt sharing.
  }
}

if (enabled) {
  const script = document.createElement('script');
  script.src = 'https://e.meettime.at/static/array.js';
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  script.onload = () => {
    window.posthog.init('phc_unb7fV3zLmVUAKCJW7DDwK4BpvKoaqxwicpnhLh8ijpw', {
      api_host: 'https://e.meettime.at',
      ui_host: 'https://us.posthog.com',
      defaults: '2026-08-30',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      disable_persistence: true,
      person_profiles: 'never',
      respect_dnt: true,
      before_send(event) {
        if (!['$pageview', 'shared_link_opened', 'link_copied', 'copy_failed', 'timezone_preview_opened', 'timezone_preview_changed'].includes(event.event)) return null;
        const allowed = [
          'token', 'distinct_id', '$device_id', '$session_id', '$window_id', '$process_person_profile',
          '$lib', '$lib_version', '$browser', '$browser_version', '$os', '$os_version', '$device_type',
          '$screen_height', '$screen_width', '$viewport_height', '$viewport_width', '$geoip_disable',
        ];
        if (event.event === 'link_copied') allowed.push('timezone');
        if (['link_copied', 'shared_link_opened', 'timezone_preview_opened', 'timezone_preview_changed'].includes(event.event)) allowed.push('preview_count');
        if (event.event === 'timezone_preview_opened') allowed.push('source');
        if (event.event === 'timezone_preview_changed') allowed.push('action');
        if (event.event === '$pageview') allowed.push('entry_type');
        if (event.event === 'shared_link_opened') allowed.push('different_timezone');
        event.properties = Object.fromEntries(Object.entries(event.properties).filter(([key]) => allowed.includes(key)));
        event.properties.environment = local ? 'development' : 'production';
        event.properties.$geoip_disable = true;
        event.properties.$current_url = location.origin + location.pathname;
        event.properties.$host = location.host;
        event.properties.$pathname = location.pathname;
        if (document.referrer) {
          const referrer = new URL(document.referrer);
          event.properties.$referrer = referrer.origin;
          event.properties.$referring_domain = referrer.hostname;
        }
        return event;
      },
      loaded(posthog) {
        client = posthog;
        for (const [event, properties] of pending.splice(0)) track(event, properties);
      },
    });
  };
  document.head.append(script);
  let entryType;
  try {
    entryType = readSelection(location.hash) ? 'shared' : 'new';
  } catch {
    entryType = 'invalid';
  }
  track('$pageview', { entry_type: entryType });
}
