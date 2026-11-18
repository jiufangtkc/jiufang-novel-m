/**
 * WO-95：測試用的範例書情境。App 啟動已不放範例書，需要範例書的測試由這裡明確放進 state。
 * 只用 src/data/demo.ts 的既有範例常數與程式產生的資料，不碰任何真書稿或使用者 .db。
 */
import { createDemoSchedule, DEMO_PROJECTS, demoLogs, type DemoProject } from '../../data/demo';
import type { GoalSchedule } from '../../domain/dailyGoal';
import { normalizeLoadedProject } from '../../domain/outline';
import { emptyWritingLog, type WritingLogRow } from '../../domain/writingLog';
import { cloneDemoProject, createState, type SampleState } from '../sampleStore';

/** 四份內建範例書，經載入時同一套正規化（補 origin 等），和舊版 App 啟動時的樣子相同。 */
export function demoFixtureProjects(): DemoProject[] {
  return DEMO_PROJECTS.map((project) =>
    normalizeLoadedProject({ ...cloneDemoProject(project), origin: project.origin ?? 'demo' }),
  );
}

/** 舊版範例紀錄：今天那一列對上結算狀態裡今天的字數（與舊版 createState 相同算法）。 */
function demoLogsAligned(schedule: GoalSchedule): WritingLogRow[] {
  const logs = demoLogs();
  const open = schedule.open;
  if (!open) return logs;
  if (logs.some((log) => log.date === open.dayKey)) {
    return logs.map((log) => (log.date === open.dayKey ? { ...log, word_count: open.wordCount } : log));
  }
  const id = logs.reduce((max, log) => Math.max(max, log.id), 0) + 1;
  return [...logs, { ...emptyWritingLog(id, open.dayKey), word_count: open.wordCount }];
}

/**
 * 有四份範例書的起始狀態，取代舊版 App 預設的範例資料。
 * 本機儲存（若測試有放）讀回的稿子照舊在前；其中已有的範例書沿用讀回的那份，缺的範例書補在後面。
 * withDemoStats 為 true 時，也放回舊版固定範例紀錄（今天 300 字與既有結算），給需要「有紀錄」的測試用。
 */
export function demoFixtureState(
  now: Date = new Date(),
  options: { withDemoStats?: boolean } = {},
): SampleState {
  const base = createState(now);
  const present = new Set(base.projects.map((project) => project.id));
  const projects = [
    ...base.projects,
    ...demoFixtureProjects().filter((project) => !present.has(project.id)),
  ];
  const next: SampleState = {
    ...base,
    projects,
    recentIds: projects.map((project) => project.id),
  };
  if (!options.withDemoStats) return next;
  const schedule = createDemoSchedule(now);
  const logs = demoLogsAligned(schedule);
  return { ...next, schedule, demoSchedule: schedule, logs, demoLogs: logs };
}
