/* End-to-end smoke test in a mobile viewport with mocked ElevenLabs + Anthropic. */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(__dirname, '../e2e-out');
fs.mkdirSync(OUT, { recursive: true });

const scribe = {
  language_code: 'heb',
  text: '',
  words: [],
};
function addUtterance(speaker, text, t0) {
  let t = t0;
  for (const w of text.split(' ')) {
    scribe.words.push({ text: w, start: t, end: t + 0.4, type: 'word', speaker_id: speaker });
    scribe.words.push({ text: ' ', start: t + 0.4, end: t + 0.5, type: 'spacing', speaker_id: speaker });
    t += 0.5;
  }
  return t;
}
let t = 0;
t = addUtterance('speaker_0', 'שלום דני, תודה שהגעת. רציתי לעבור איתך על ההסדר מול הבנק.', t);
t = addUtterance('speaker_1', 'כן, קיבלתי את המכתב שלהם. הם דורשים 180 אלף שקל עד סוף החודש.', t + 1);
t = addUtterance('speaker_0', 'אני אגיש בקשה לעיכוב הליכים עד יום חמישי, ואתה תעביר לי את דפי החשבון של שלושת החודשים האחרונים.', t + 1);
t = addUtterance('speaker_1', 'בסדר, אשלח אותם מחר בבוקר.', t + 1);
scribe.text = scribe.words.filter((w) => w.type === 'word').map((w) => w.text).join(' ');

const summary = {
  title: 'הסדר חוב מול הבנק',
  overview: 'עו"ד ירין אשואל נפגש עם הלקוח דני לדיון בדרישת הבנק לתשלום של 180,000 ש"ח עד סוף החודש. סוכם על הגשת בקשה לעיכוב הליכים והעברת מסמכים פיננסיים.',
  keyPoints: ['הבנק דורש תשלום של 180,000 ש"ח עד סוף החודש.', 'הלקוח קיבל מכתב דרישה רשמי.'],
  decisions: ['תוגש בקשה לעיכוב הליכים.'],
  tasks: [
    { title: 'הגשת בקשה לעיכוב הליכים', owner: 'עו"ד ירין אשואל', due: 'עד יום חמישי' },
    { title: 'העברת דפי חשבון לשלושת החודשים האחרונים', owner: 'דני', due: 'מחר בבוקר' },
  ],
  openQuestions: ['האם הבנק יסכים לפריסת תשלומים?'],
  nextMeeting: '',
};

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    locale: 'he-IL',
    permissions: ['microphone'],
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  let elCalls = 0;
  let anCalls = 0;
  await page.route('https://api.elevenlabs.io/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/speech-to-text')) {
      elCalls++;
      const ct = req.headers()['content-type'] || '';
      if (!ct.includes('multipart/form-data')) return route.fulfill({ status: 400, body: 'expected multipart' });
      if (req.headers()['xi-api-key'] !== 'TEST_ELEVENLABS_VALUE') return route.fulfill({ status: 401, body: '{"detail":{"status":"invalid_api_key"}}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scribe) });
    }
    if (req.url().includes('/user/subscription')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 'starter', character_count: 1000, character_limit: 30000 }) });
    }
    return route.continue();
  });
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.url().endsWith('/v1/models?limit=1')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
    }
    anCalls++;
    const body = req.postDataJSON();
    if (!body.tools || body.tool_choice?.name !== 'save_meeting_summary') return route.fulfill({ status: 400, body: 'bad tool' });
    if (!body.messages[0].content.includes('דובר 1')) return route.fulfill({ status: 400, body: 'transcript missing speakers' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'tool_use', name: 'save_meeting_summary', input: summary }] }),
    });
  });

  const base = process.env.BASE_URL || 'http://localhost:4173';
  await page.goto(base);
  await page.waitForSelector('text=הפגישות שלי');
  await page.screenshot({ path: `${OUT}/01-home-empty.png` });

  // Settings
  await page.getByRole('button', { name: 'הגדרות', exact: true }).click();
  await page.waitForSelector('text=מפתחות API');
  await page.getByPlaceholder('sk_...').fill('TEST_ELEVENLABS_VALUE');
  await page.getByPlaceholder('sk-ant-...').fill('TEST_ANTHROPIC_VALUE');
  await page.getByRole('button', { name: 'בדוק מפתח' }).first().click();
  await page.waitForSelector('text=המפתח תקין');
  await page.screenshot({ path: `${OUT}/02-settings.png` });
  await page.getByRole('button', { name: 'שמור הגדרות' }).click();
  await page.waitForSelector('text=הפגישות שלי');

  // New meeting
  await page.getByRole('button', { name: 'הקלטת פגישה' }).click();
  await page.getByPlaceholder('שם הלקוח או מספר התיק').fill('דני כהן');
  await page.getByPlaceholder('למשל: ירין, דני כהן, רו״ח לוי').fill('ירין, דני');
  await page.screenshot({ path: `${OUT}/03-new-meeting.png` });
  await page.getByRole('button', { name: 'התחל הקלטה' }).click();
  await page.waitForSelector('text=מקליט');
  await page.waitForTimeout(2500);
  await page.getByPlaceholder('נקודות שחשוב לך שייכנסו לסיכום...').fill('לבדוק מול הבנק אפשרות פריסה');
  await page.screenshot({ path: `${OUT}/04-recording.png` });
  await page.getByRole('button', { name: 'סיים פגישה' }).click();
  await page.getByRole('button', { name: 'סיים ועבד' }).click();

  await page.waitForSelector('text=מעבד את הפגישה', { timeout: 10000 }).catch(() => undefined);
  await page.screenshot({ path: `${OUT}/05-processing.png` });
  await page.waitForSelector('.chip.ok', { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/06-summary.png`, fullPage: true });

  await page.getByRole('tab', { name: /משימות/ }).click();
  await page.locator('.task .check').first().click();
  await page.screenshot({ path: `${OUT}/07-tasks.png` });

  await page.getByRole('tab', { name: 'תמלול' }).click();
  await page.locator('.seg .who button').first().click();
  await page.getByPlaceholder('למשל: ירין, הלקוח, רו״ח לוי').fill('ירין');
  await page.getByRole('button', { name: 'שמור', exact: true }).click();
  await page.waitForSelector('.seg .who button:has-text("ירין")');
  await page.screenshot({ path: `${OUT}/08-transcript.png` });

  // Download docx
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'הורד' }).click()]);
  const docxPath = `${OUT}/${download.suggestedFilename()}`;
  await download.saveAs(docxPath);

  // Back home, list shows meeting
  await page.getByRole('button', { name: 'חזרה', exact: true }).click();
  await page.waitForSelector('.meeting-item');
  await page.screenshot({ path: `${OUT}/09-home-list.png` });

  // Error path: wrong key
  await page.getByRole('button', { name: 'הגדרות', exact: true }).click();
  await page.getByPlaceholder('sk_...').fill('wrong');
  await page.getByRole('button', { name: 'שמור הגדרות' }).click();
  await page.locator('.meeting-item').first().click();
  await page.getByRole('button', { name: 'פעולות נוספות' }).click();
  await page.getByRole('button', { name: 'תמלל מחדש מההקלטה' }).click();
  await page.waitForSelector('.chip.err', { timeout: 15000 });
  await page.waitForSelector('text=מפתח ElevenLabs לא תקין');
  await page.screenshot({ path: `${OUT}/10-error.png` });

  // Dark mode shot
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'חזרה', exact: true }).click();
  await page.waitForSelector('.meeting-item');
  await page.screenshot({ path: `${OUT}/11-home-dark.png` });

  console.log(JSON.stringify({ elCalls, anCalls, docxPath, errors }, null, 2));
  await browser.close();
  if (errors.length) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
