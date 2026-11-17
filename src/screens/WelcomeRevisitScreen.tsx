import { useNavigate, useParams } from 'react-router-dom';
import { manuscriptWritePath } from '../domain/openManuscript';
import { useProject, useSample } from '../state/sampleStore';
import { useOpenManuscriptFile } from './useOpenManuscriptFile';
import { WELCOME_START_NEW_STATE } from './welcomeStart';
import { useWelcomeSteps } from './WelcomeSteps';
import { WelcomeTour } from './WelcomeTour';

/** 設定頁外觀組（主題）那一格；導覽收尾點外觀那一行，到設定頁後捲到這裡。 */
const APPEARANCE_ANCHOR = '[data-testid="theme-setting"]';

function scrollToAppearanceSoon() {
  if (typeof window === 'undefined') return;
  // 等設定頁畫出來（兩個畫格）再捲；找不到就算了，停在設定頁頂端。
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      document.querySelector(APPEARANCE_ANCHOR)?.scrollIntoView({ block: 'start' });
    }),
  );
}

/**
 * 從「設定 › 關於 › 再看一次歡迎導覽」叫出來的導覽（WO-110，取代 WO-108 的過渡空頁）。
 * 歡迎頁右上是「關閉」：回設定頁，什麼都不改。
 * WO-111：第 1、2 關帶入目前的值（第 2 關改的是新稿子預設，不改這份稿子）；第 3 關多「繼續寫這份稿子」並預選；
 * 收尾照第 3 關結果分流；外觀那一行可連到設定的外觀組。
 */
export function WelcomeRevisitScreen() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const { state, isGlowing } = useSample();
  const project = useProject(projectId);
  const openFile = useOpenManuscriptFile();
  const steps = useWelcomeSteps({
    entry: 'revisit',
    project: project ? { id: project.id, title: project.title } : null,
  });
  return (
    <>
      {openFile.input}
      <WelcomeTour
        entry="revisit"
        todayWords={state.schedule.open?.wordCount ?? 0}
        dailyGoal={state.schedule.open?.goals.at(-1)?.goal ?? state.schedule.defaultGoal}
        met={isGlowing}
        {...steps}
        appearanceTo={project ? `/p/${project.id}/settings` : undefined}
        onExit={(exit) => {
          if (exit === 'finish-home') navigate('/');
          else if (exit === 'finish-continue' && project) navigate(manuscriptWritePath(project));
          else if (exit === 'finish-new') navigate('/', { state: WELCOME_START_NEW_STATE });
          else if (exit === 'finish-open') {
            // 在這一下點擊裡直接開系統選檔；選了就進那份稿子，沒選或打不開就回首頁。
            openFile.open((result) => {
              if (result !== 'opened') navigate('/');
            });
          } else if (exit === 'appearance') scrollToAppearanceSoon();
          else navigate(`/p/${projectId}/settings`);
        }}
      />
    </>
  );
}
