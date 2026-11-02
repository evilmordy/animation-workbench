import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { freshStart } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

async function putFile(page: import('@playwright/test').Page, path: string, bytes: number[]) {
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

test('M4：导入 PDF（中文文本层、页码范围）和 GBK 文本，用作 AI 素材', async ({ page }) => {
  await freshStart(page);
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
  await page.getByTestId('save-draft').click();

  // GBK 编码的文本文件："二分查找"
  await putFile(page, '/files/note.txt', [0xb6, 0xfe, 0xb7, 0xd6, 0xb2, 0xe9, 0xd5, 0xd2]);
  await page.getByTestId('import-file').click();
  await expect(draft).toHaveValue('二分查找');
  await page.getByTestId('save-draft').click();

  await expect(page.getByTestId('inputs-panel').getByRole('checkbox')).toHaveCount(2);
  await page.getByTestId('use-inputs').click();
  const source = page.getByTestId('source-text').locator('textarea');
  await expect(source).toHaveValue(/【sample.pdf】[\s\S]*勾股定理[\s\S]*【note.txt】\n二分查找/);
});
