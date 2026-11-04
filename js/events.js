// MSA event cards. Each `.event` in index.html carries its start and end as
// Pacific "YYYY-MM-DDTHH:MM" times; this shows it until it ends and words its
// day relative to today ("Tonight", "Tomorrow", "This Friday, Nov 6").

const TIME_ZONE = 'America/Los_Angeles';

function claremontNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const format = (date, options) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));

export function eventDay(start, now) {
  const day = start.slice(0, 10);
  const away = daysBetween(now.slice(0, 10), day);
  if (away === 0) return start.slice(11) >= '17:00' ? 'Tonight' : 'Today';
  if (away === 1) return 'Tomorrow';
  const date = format(day, { month: 'short', day: 'numeric' });
  if (away > 1 && away < 7) return `This ${format(day, { weekday: 'long' })}, ${date}`;
  return `${format(day, { weekday: 'long' })}, ${date}`;
}

export function showEvents(root, now = claremontNow()) {
  let shown = 0;
  for (const card of root.querySelectorAll('.event')) {
    const { start, end } = card.dataset;
    const over = !end || now >= end;
    card.hidden = over;
    if (over) continue;
    shown++;
    const when = card.querySelector('[data-when]');
    if (when) when.textContent = now >= start ? 'Happening now' : eventDay(start, now);
  }
  root.hidden = shown === 0;
}
