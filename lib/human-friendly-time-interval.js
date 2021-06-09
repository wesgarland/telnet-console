'use strict';

/** Format a time interval expressed in milliseconds into idiomatic English, e.g.
 *  "3 years, 11 days, 18 hours, 53:24.1"
 *
 *  @param    ms      The number of milliseconds in the time interval
 *  @param    prefix  A prefix to put in front of each temporal unit; use eg. to express
 *                    intervals in core-years instead of years.
 *  @param    locale  The locale for which to format the string
 *
 *  @returns the human-formatted time interval as a string
 */
exports.humanFriendlyTimeInterval = function humanFriendlyTimeInterval(ms, prefix, locale)
{
  if (!prefix) {
    prefix = '';
  }

  if (locale)
    console.warn(`Warning: locale ${locale} not supported; using default`);
  
  ms = Math.floor(ms);

  if (ms >= 365 * 86400000)     // over 1 year? list years and continue
    return Math.floor(ms / (365 * 86400000)).toFixed(0) + ' ' + prefix + 'years, ' + humanFriendlyTimeInterval(ms % (365 * 86400000), prefix);

  if (ms >= 86400000)           // over 1 day? list days and continue
    return Math.floor(ms / 86400000).toFixed(0) + ' ' + prefix + 'days, ' + humanFriendlyTimeInterval(ms % 86400000, prefix);


  // else, we're below two days, so should show hours, mm:ss
  
  const h = (Math.floor(ms / 3600000) % 24).toString(10);
  const m = (Math.floor(ms /   60000) % 60).toString(10);
  const s = (Math.floor(ms /    1000) % 60).toFixed(1);

  return `${h} hour${h==='1'?'':'s'}, ${m}:${s.padStart(4, '0')}`;
}

