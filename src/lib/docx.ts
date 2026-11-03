import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { Meeting, Settings } from '../types';
import { speakerLabel } from './elevenlabs';
import { clockFromSeconds, formatDate, formatDurationWords, formatTime } from './format';

const FONT = 'David';
const SIZE = 24; // 12pt in half-points
const INK = '1F2937';
const MUTED = '6B7280';
const LINE = 'D1D5DB';
const SHADE = 'F3F4F6';

function run(text: string, opts: Partial<ConstructorParameters<typeof TextRun>[0] & object> = {}): TextRun {
  return new TextRun({ text, font: FONT, size: SIZE, rightToLeft: true, color: INK, ...(opts as object) });
}

function para(
  children: TextRun[] | string,
  opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number; indent?: number } = {},
): Paragraph {
  const kids = typeof children === 'string' ? [run(children)] : children;
  return new Paragraph({
    children: kids,
    bidirectional: true,
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: 360 },
    indent: opts.indent ? { left: opts.indent } : undefined,
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    children: [run(text, { bold: true, underline: { type: UnderlineType.SINGLE }, size: 26 })],
    bidirectional: true,
    alignment: AlignmentType.JUSTIFIED,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    keepNext: true,
  });
}

function numbered(items: string[]): Paragraph[] {
  return items.map((t, i) =>
    new Paragraph({
      children: [run(`${i + 1}.\t`), run(t)],
      bidirectional: true,
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 100, line: 360 },
      indent: { left: 567, hanging: 567 },
      tabStops: [{ type: 'left', position: 567 }],
    }),
  );
}

function emptyLine(): Paragraph {
  return new Paragraph({ children: [run('')], spacing: { after: 60 } });
}

function cell(text: string, opts: { bold?: boolean; shade?: boolean; width: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): TableCell {
  return new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: SHADE, color: 'auto' } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [run(text || '', { bold: opts.bold })],
        bidirectional: true,
        alignment: opts.align ?? AlignmentType.JUSTIFIED,
        spacing: { after: 0, line: 300 },
      }),
    ],
  });
}

const tableBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: LINE },
};

export async function buildMeetingDocx(meeting: Meeting, settings: Settings): Promise<Blob> {
  const s = meeting.summary;
  const names = meeting.speakerNames;
  const children: (Paragraph | Table)[] = [];

  // Title block
  children.push(
    new Paragraph({
      children: [run('סיכום פגישה', { bold: true, size: 32 })],
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [run(s?.title || meeting.title, { bold: true, size: 26 })],
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
  );

  // Metadata table
  const metaRows: [string, string][] = [
    ['תאריך', `${formatDate(meeting.createdAt)}, בשעה ${formatTime(meeting.createdAt)}`],
    ['משך הפגישה', formatDurationWords(meeting.durationMs)],
  ];
  if (meeting.client) metaRows.push(['לקוח / תיק', meeting.client]);
  if (meeting.participants) metaRows.push(['משתתפים', meeting.participants]);
  if (settings.lawyerName) metaRows.push(['נערך על ידי', settings.lawyerName]);

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: true,
      borders: tableBorders,
      rows: metaRows.map(
        ([k, v]) =>
          new TableRow({
            children: [cell(k, { bold: true, shade: true, width: 25 }), cell(v, { width: 75 })],
          }),
      ),
    }),
    emptyLine(),
  );

  if (s) {
    children.push(heading('תמצית הפגישה'), para(s.overview || 'לא נמסר סיכום.'));

    if (s.keyPoints.length) {
      children.push(heading('עיקרי הדברים'), ...numbered(s.keyPoints));
    }

    children.push(heading('החלטות שהתקבלו'));
    if (s.decisions.length) children.push(...numbered(s.decisions));
    else children.push(para([run('לא התקבלו החלטות בפגישה זו.', { color: MUTED })]));

    children.push(heading('משימות להמשך'));
    if (s.tasks.length) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          visuallyRightToLeft: true,
          borders: tableBorders,
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                cell('#', { bold: true, shade: true, width: 6, align: AlignmentType.CENTER }),
                cell('המשימה', { bold: true, shade: true, width: 54 }),
                cell('אחראי', { bold: true, shade: true, width: 20 }),
                cell('מועד', { bold: true, shade: true, width: 20 }),
              ],
            }),
            ...s.tasks.map(
              (t, i) =>
                new TableRow({
                  children: [
                    cell(String(i + 1), { width: 6, align: AlignmentType.CENTER }),
                    cell(t.title, { width: 54 }),
                    cell(t.owner || '', { width: 20 }),
                    cell(t.due || '', { width: 20 }),
                  ],
                }),
            ),
          ],
        }),
      );
    } else {
      children.push(para([run('לא הוגדרו משימות להמשך.', { color: MUTED })]));
    }

    if (s.openQuestions.length) {
      children.push(heading('שאלות פתוחות'), ...numbered(s.openQuestions));
    }
    if (s.nextMeeting) {
      children.push(heading('פגישת המשך'), para(s.nextMeeting));
    }
  }

  if (meeting.notes?.trim()) {
    children.push(heading('הערות שנרשמו במהלך הפגישה'), para(meeting.notes.trim()));
  }

  // Transcript appendix
  if (meeting.transcript?.segments?.length) {
    children.push(
      new Paragraph({
        children: [run('נספח: תמלול הפגישה', { bold: true, underline: { type: UnderlineType.SINGLE }, size: 26 })],
        bidirectional: true,
        alignment: AlignmentType.JUSTIFIED,
        pageBreakBefore: true,
        spacing: { after: 120 },
      }),
      para([run('התמלול הופק באופן אוטומטי ועשוי להכיל אי דיוקים.', { color: MUTED, size: 20 })], { after: 200 }),
    );
    for (const seg of meeting.transcript.segments) {
      children.push(
        new Paragraph({
          children: [
            run(`${speakerLabel(seg.speaker, names)} `, { bold: true }),
            run(`(${clockFromSeconds(seg.start)}): `, { color: MUTED, size: 20 }),
            run(seg.text),
          ],
          bidirectional: true,
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 100, line: 340 },
        }),
      );
    }
  }

  const doc = new Document({
    creator: settings.lawyerName || 'פגישות',
    title: s?.title || meeting.title,
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE, rightToLeft: true, color: INK } },
        heading2: { run: { font: FONT, size: 26, bold: true, color: INK } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [run(settings.firmName || settings.lawyerName || '', { color: MUTED, size: 20 })],
                bidirectional: true,
                alignment: AlignmentType.CENTER,
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  run('עמוד ', { color: MUTED, size: 20 }),
                  new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20, color: MUTED }),
                  run(' מתוך ', { color: MUTED, size: 20 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 20, color: MUTED }),
                ],
                bidirectional: true,
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
