import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { freshStart } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

async function putFile(page: Page, path: string, bytes: number[]) {
  await page.waitForFunction(() => (window as any).__awbMock);
  await page.evaluate(
    async ({ path, bytes }) => {
      const m = (window as any).__awbMock;
      await m.platform.mkdir(path.slice(0, path.lastIndexOf('/')));
      await m.platform.writeBinary(path, new Uint8Array(bytes));
      m.dialogs.nextFile = path;
    },
    { path, bytes },
  );
}

/**
 * 「保存素材」要点到文件写完、`updateProject` 把这条放进列表之后才算结束；
 * Playwright 的 click 在事件发出去时就返回。上一次保存还在写时就导入下一份，
 * 前一次收尾的 `draft = null` 会把新弹层关掉，第二次点击落空，列表里只剩一条。
 * 机器被 UX-03 占满时这个窗口会变宽。
 */
async function saveInput(page: Page, name: string, count: number) {
  await page.getByTestId('save-draft').click();
  const panel = page.getByTestId('inputs-panel');
  await expect(panel.getByRole('checkbox', { name, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('checkbox')).toHaveCount(count);
  await expect(page.getByTestId('draft-text')).toHaveCount(0);
}

test('M4：导入 PDF（中文文本层、页码范围）和 GBK 文本，用作 AI 素材', async ({ page }) => {
  await freshStart(page);
  // create() 发现目录里已有 project.json 会直接打开旧项目。默认路径总是
  // `/projects/动画项目1`，和别的「新建项目」用例相同。这条用例用自己的目录，
  // 避免打开到一份已经写过素材的项目。
  await page.waitForFunction(() => (window as any).__awbMock);
  await page.evaluate(() => {
    const id = `m4-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    (window as any).__awbMock.dialogs.nextDirectory = `/projects/${id}`;
  });
  await page.getByTestId('new-project').click();
  await page.getByRole('tab', { name: '素材' }).click();

  await putFile(page, '/files/sample.pdf', [...readFileSync('tests/fixtures/sample.pdf')]);
  await page.getByTestId('import-file').click();
  const draft = page.getByTestId('draft-text').locator('textarea');
  await expect(draft).toHaveValue(/勾股定理[\s\S]*第二页/, { timeout: 20_000 });
  // 只读第 1 页
  const to = page.getByLabel('结束页');
  await to.fill('1');
  await to.blur();
  await page.getByRole('button', { name: '重新读取' }).click();
  await expect(draft).not.toHaveValue(/第二页/);
  await expect(draft).toHaveValue(/直角三角形[\s\S]*a²/);
  await saveInput(page, 'sample.pdf', 1);

  // GBK 编码的文本文件："二分查找"
  await putFile(page, '/files/note.txt', [0xb6, 0xfe, 0xb7, 0xd6, 0xb2, 0xe9, 0xd5, 0xd2]);
  await page.getByTestId('import-file').click();
  await expect(draft).toHaveValue('二分查找');
  await saveInput(page, 'note.txt', 2);

  await page.getByTestId('use-inputs').click();
  const source = page.getByTestId('source-text').locator('textarea');
  await expect(source).toHaveValue(/【sample.pdf】[\s\S]*勾股定理[\s\S]*【note.txt】\n二分查找/);
});
