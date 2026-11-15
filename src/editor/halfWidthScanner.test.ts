import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHalfWidthScanner, HALF_WIDTH_IDLE_MS } from './halfWidthScanner';

function setup(initial = '') {
  const box = { value: initial };
  const scans: string[][] = [];
  const shifts: number[] = [];
  const scanner = createHalfWidthScanner({
    read: () => box.value,
    onScan: (marks, text) => scans.push(marks.map((mark) => text.slice(mark.start, mark.end))),
    onShift: (marks) => shifts.push(marks.length),
  });
  return { box, scans, shifts, scanner };
}

describe('WO-76 乙段：檢查時機（停筆 3 秒、組字保護）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('WO-76 乙段：停筆約 3 秒才檢查，繼續打字就重新計時', () => {
    expect(HALF_WIDTH_IDLE_MS).toBe(3000);
    const { box, scans, scanner } = setup('');
    scanner.start();
    expect(scans).toEqual([[]]);
    box.value = '他說,';
    scanner.input();
    vi.advanceTimersByTime(2900);
    expect(scans).toHaveLength(1);
    box.value = '他說,走吧.';
    scanner.input();
    vi.advanceTimersByTime(2900);
    expect(scans).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(scans).toEqual([[], [',', '.']]);
  });

  it('WO-76 乙段：組字中（候選字未選定）停了 3 秒也不檢查；compositionend 之後重新計時', () => {
    const { box, scans, scanner } = setup('他說,');
    scanner.start();
    expect(scans).toHaveLength(1);
    scanner.compositionStart();
    box.value = '他說,ㄗㄡˇ';
    scanner.input();
    vi.advanceTimersByTime(10_000);
    expect(scans).toHaveLength(1);
    expect(scanner.composing).toBe(true);
    // 改成全形等動作在組字中也不會重新檢查
    scanner.rescan();
    expect(scans).toHaveLength(1);
    // 選完字：重新計時 3 秒
    box.value = '他說,走.';
    scanner.compositionEnd();
    vi.advanceTimersByTime(2999);
    expect(scans).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(scans).toHaveLength(2);
    expect(scans[1]).toEqual([',', '.']);
  });

  it('WO-76 乙段：打字前已經在計時，進入組字就先停掉，選完字才重算 3 秒', () => {
    const { box, scans, scanner } = setup('');
    scanner.start();
    box.value = '好.';
    scanner.input();
    vi.advanceTimersByTime(2000);
    scanner.compositionStart();
    vi.advanceTimersByTime(5000);
    expect(scans).toHaveLength(1);
    box.value = '好.走';
    scanner.compositionEnd();
    vi.advanceTimersByTime(2000);
    expect(scans).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(scans).toHaveLength(2);
  });

  it('WO-76 乙段：收起鍵盤時沒在組字就直接檢查；組字中收起則不檢查', () => {
    const { box, scans, scanner } = setup('');
    scanner.start();
    box.value = '他說,';
    scanner.input();
    scanner.blur();
    expect(scans.at(-1)).toEqual([',']);

    scanner.compositionStart();
    box.value = '他說,ㄅ';
    scanner.input();
    scanner.blur();
    expect(scans).toHaveLength(2);
  });

  it('WO-76 乙段：檢查只讀正文，不改字', () => {
    const { box, scanner } = setup('他說,走吧.');
    scanner.start();
    vi.advanceTimersByTime(5000);
    expect(box.value).toBe('他說,走吧.');
    expect(scanner.marks).toHaveLength(2);
  });

  it('WO-76 乙段：離開這一章（取消）之後，延後的檢查不會再跑', () => {
    const { box, scans, scanner } = setup('');
    scanner.start();
    box.value = '他說,';
    scanner.input();
    scanner.cancel();
    vi.advanceTimersByTime(5000);
    expect(scans).toHaveLength(1);
  });
});
