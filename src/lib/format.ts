export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDurationWords(ms: number): string {
  const total = Math.round(ms / 60000);
  if (total < 1) return 'פחות מדקה';
  if (total === 1) return 'דקה';
  if (total < 60) return `${total} דקות`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hw = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
  return m ? `${hw} ו-${m} דק׳` : hw;
}

export function formatDate(ts: number): string {
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(ts);
}

export function formatDateShort(ts: number): string {
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts);
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(ts);
}

export function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'היום';
  if (sameDay(d, yesterday)) return 'אתמול';
  return formatDate(ts);
}

export function isoDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function safeFileName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export function clockFromSeconds(sec: number): string {
  return formatDuration(sec * 1000);
}
