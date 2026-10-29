import { describe, expect, it } from 'vitest';
import { filesPageLayout } from './filesPageLayout';

describe('檔案頁版面', () => {
  it('不支援直接寫回時不顯示儲存專案，主按鈕是另存專案', () => {
    const layout = filesPageLayout(false);
    expect(layout.showSaveProject).toBe(false);
    expect(layout.showLastProjectSave).toBe(false);
    expect(layout.primaryIsSaveAs).toBe(true);
    expect(layout.showSaveAs).toBe(true);
    expect(layout.showStashDraft).toBe(true);
  });

  it('支援直接寫回時三個存檔動作都在，主按鈕是儲存專案', () => {
    const layout = filesPageLayout(true);
    expect(layout.showSaveProject).toBe(true);
    expect(layout.showLastProjectSave).toBe(true);
    expect(layout.primaryIsSaveAs).toBe(false);
    expect(layout.showSaveAs).toBe(true);
    expect(layout.showStashDraft).toBe(true);
  });
});
