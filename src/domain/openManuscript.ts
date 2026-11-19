import type { ChapterNode, DemoProject } from '../data/demo';
import { findNode } from '../data/demo';
import { countNodes, writingOrder } from './chapterOps';

export function newChapterId(projectId: string): string {
  return `${projectId}-ch`;
}

/** WO-124b：長篇新稿範例的卷、幕 ID，穩定且和章 ID 互異。 */
export function newVolumeId(projectId: string): string {
  return `${projectId}-vol`;
}

export function newSceneId(projectId: string): string {
  return `${projectId}-sc`;
}

/**
 * 新稿子建好後第一個要開的節點：長篇是範例的第一幕，單篇是唯一的章。
 * reducer 的 lastOpenedNodeId 與首頁導向共用這一條規則。
 */
export function newManuscriptFirstNodeId(projectId: string, shape: DemoProject['shape']): string {
  return shape === 'novel' ? newSceneId(projectId) : newChapterId(projectId);
}

export function shapeAfterEdit(
  shape: DemoProject['shape'],
  nodes: readonly ChapterNode[],
): DemoProject['shape'] {
  if (shape === 'single' && countNodes(nodes, 'file') > 1) return 'novel';
  return shape;
}

/** 單篇直接進那一章。其他稿子有上次位置就回到那一章。 */
export function resumeChapterId(
  project: Pick<DemoProject, 'shape' | 'lastOpenedNodeId' | 'nodes'>,
): string | null {
  if (project.shape === 'single') {
    const file = writingOrder(project.nodes).find((node) => node.type === 'file');
    if (file) return file.id;
  }
  if (project.lastOpenedNodeId && findNode(project.nodes, project.lastOpenedNodeId)) {
    return project.lastOpenedNodeId;
  }
  return null;
}

export function manuscriptWritePath(
  project: Pick<DemoProject, 'id' | 'shape' | 'lastOpenedNodeId' | 'nodes'>,
): string {
  return writePath(project.id, resumeChapterId(project));
}

export function writePath(projectId: string, chapterId?: string | null): string {
  return chapterId ? `/p/${projectId}/write/${chapterId}` : `/p/${projectId}/write`;
}
