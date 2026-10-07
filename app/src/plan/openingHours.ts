const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY = '(?:Su|Mo|Tu|We|Th|Fr|Sa)';
const DAY_LIST = new RegExp(`^(${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*)?\\s*(.*)$`);
const TIMES = /^\d\d:\d\d-\d\d:\d\d(?:,\s*\d\d:\d\d-\d\d:\d\d)*$/;

function weekdays(list: string): number[] {
  return list.split(',').flatMap((range) => {
    const [from, to = from] = range.split('-').map((d) => DAYS.indexOf(d));
    const out = [from];
    for (let d = from; d !== to;) out.push((d = (d + 1) % 7));
    return out;
  });
}

/**
 * Opening hours per weekday (0 = Sunday) from the common forms of the OpenStreetMap syntax, such as
 * "Mo-Sa 08:00-20:00; Su 10:00-16:00" or "24/7"; null marks a closed day. Null for anything else
 * (public holidays, months, sunrise...), so unclear hours are never reported as closed.
 */
export function parseOpeningHours(text: string): (string | null)[] | null {
  const value = text.trim();
  if (value === '24/7') return Array<string>(7).fill('24 h');
  const week: (string | null)[] = Array<null>(7).fill(null);
  let open = false;
  for (const rule of value.split(';').map((r) => r.trim())) {
    if (!rule) continue;
    const [, days, times] = DAY_LIST.exec(rule) ?? [];
    const which = days ? weekdays(days) : [0, 1, 2, 3, 4, 5, 6];
    const hours = times?.trim() ?? '';
    if (hours === 'off' || hours === 'closed') {
      for (const d of which) week[d] = null;
    } else if (TIMES.test(hours)) {
      for (const d of which) week[d] = hours.replace(/,\s*/g, ', ');
      open = true;
    } else {
      return null;
    }
  }
  return open ? week : null;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
