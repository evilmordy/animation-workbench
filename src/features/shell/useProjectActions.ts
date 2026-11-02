import { useDialog, useMessage } from 'naive-ui';
import { describeError } from '../../shared/errors';
import { ProjectError, useProjectStore } from '../../stores/project';

/** 打开/新建项目的界面流程：统一处理错误提示和"从快照恢复" */
export function useProjectActions() {
  const project = useProjectStore();
  const message = useMessage();
  const dialog = useDialog();

  async function run(action: () => Promise<boolean>, dirForRecovery?: string) {
    try {
      await action();
    } catch (e) {
      if (e instanceof ProjectError && e.recoverable && dirForRecovery) {
        dialog.warning({
          title: '项目文件损坏',
          content: `${e.message}。可以用最近一次自动快照恢复（损坏的文件会被覆盖）。`,
          positiveText: '从快照恢复',
          negativeText: '取消',
          onPositiveClick: () => run(() => project.recover(dirForRecovery)),
        });
        return;
      }
      const d = describeError(e);
      message.error(`${d.what}${d.next ? `。${d.next}` : ''}`, { duration: 8000, closable: true });
    }
  }

  return {
    openSample: () => run(() => project.openSample()),
    create: () => run(() => project.create('未命名动画')),
    open: (dir?: string) => run(() => project.open(dir), dir),
  };
}
