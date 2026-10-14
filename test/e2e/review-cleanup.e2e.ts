import { browser, expect } from '@wdio/globals';
import { pluginId } from './load';
describe('Plugin unload cleanup', () => {
 it('releases open views on plugin disable', async () => {
  await browser.executeObsidian(async ({ app }) => { await app.workspace.openLinkText('Bases Row Deltas/Readings.base#Numbers', '', false); });
  await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .bases-row-deltas tbody tr').length === 3), { timeout: 30000 });
  const result = await browser.executeObsidian(async ({ app }, id) => {
   interface P { views: Set<{ containerEl: HTMLElement }> }
   const plugins = (app as unknown as { plugins: { plugins: Record<string, P>; disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<boolean> } }).plugins;
   const plugin = plugins.plugins[id]!;
   const views = [...plugin.views];
   await plugins.disablePlugin(id);
   const result = { retained: plugin.views.size, connected: views.filter(v => v.containerEl.isConnected).length };
   await plugins.enablePlugin(id);
   return result;
  }, pluginId);
  expect(result).toEqual({ retained: 0, connected: 0 });
 });
});
