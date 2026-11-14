import {
  FILES_GROUP_IMPORT_EXPORT,
  FILES_GROUP_OPEN_CLOSE,
  FILES_GROUP_SAVE,
} from '../copy/userFacing';

export type FilesGroupKey = 'save' | 'openClose' | 'importExport';

export interface FilesGroupDefinition {
  readonly key: FilesGroupKey;
  readonly title: string;
}

/** WO-60 檔案頁三組固定分組順序：存檔、開啟與關閉、匯入與匯出 */
export const FILES_PAGE_GROUPS: readonly FilesGroupDefinition[] = [
  { key: 'save', title: FILES_GROUP_SAVE },
  { key: 'openClose', title: FILES_GROUP_OPEN_CLOSE },
  { key: 'importExport', title: FILES_GROUP_IMPORT_EXPORT },
] as const;

/** 依是否支援 File System Access 直接寫回，決定檔案頁顯示哪些動作。 */
export type FilesPageLayout = {
  showSaveProject: boolean;
  showLastProjectSave: boolean;
  primaryIsSaveAs: boolean;
  showSaveAs: boolean;
  showStashDraft: boolean;
  showImportExport: boolean;
  groups: readonly FilesGroupDefinition[];
};

export function filesPageLayout(supportsDirectWriteback: boolean): FilesPageLayout {
  if (supportsDirectWriteback) {
    return {
      showSaveProject: true,
      showLastProjectSave: true,
      primaryIsSaveAs: false,
      showSaveAs: true,
      showStashDraft: true,
      showImportExport: true,
      groups: FILES_PAGE_GROUPS,
    };
  }
  return {
    showSaveProject: false,
    showLastProjectSave: false,
    primaryIsSaveAs: true,
    showSaveAs: true,
    showStashDraft: true,
    showImportExport: true,
    groups: FILES_PAGE_GROUPS,
  };
}
