/** 依是否支援 File System Access 直接寫回，決定檔案頁顯示哪些動作。 */
export type FilesPageLayout = {
  showSaveProject: boolean;
  showLastProjectSave: boolean;
  primaryIsSaveAs: boolean;
  showSaveAs: boolean;
  showStashDraft: boolean;
};

export function filesPageLayout(supportsDirectWriteback: boolean): FilesPageLayout {
  if (supportsDirectWriteback) {
    return {
      showSaveProject: true,
      showLastProjectSave: true,
      primaryIsSaveAs: false,
      showSaveAs: true,
      showStashDraft: true,
    };
  }
  return {
    showSaveProject: false,
    showLastProjectSave: false,
    primaryIsSaveAs: true,
    showSaveAs: true,
    showStashDraft: true,
  };
}
