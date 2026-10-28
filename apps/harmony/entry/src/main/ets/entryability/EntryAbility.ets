import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.getMainWindow().then(async (main: window.Window) => {
      await main.setWindowLayoutFullScreen(false);
      await main.setWindowSystemBarProperties({ statusBarColor: '#f7f6f2', navigationBarColor: '#f7f6f2', statusBarContentColor: '#343a32', navigationBarContentColor: '#343a32' });
      stage.loadContent('pages/Index');
    }).catch(() => stage.loadContent('pages/Index'));
  }
}
