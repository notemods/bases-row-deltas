import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId } from './load';

// A free user opens a Row deltas view with saved Pro options (Second and Third number property). The shared Pro notice
// must show once, with a Sponsor on GitHub button that opens the one-time tab of the Sponsors page with metadata_source=<plugin id>.
const BASE = 'Bases Row Deltas/Readings.base';
const NOTE = 'Bases Row Deltas/Notes/North 02.md';
const LEAD = 'Second and third properties, row offsets and change per day are Pro features.';
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

interface Shown { text: string; buttons: number }
interface ViewState { cells: number; pro: boolean; value: string }

async function notices(): Promise<Shown[]> {
	return browser.execute(() => [...(window as unknown as { activeWindow: Window }).activeWindow.document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));
}
async function clearNotices(): Promise<void> {
	await browser.execute(() => { for (const doc of new Set([document, (window as unknown as { activeWindow: Window }).activeWindow.document])) doc.querySelectorAll('.notice').forEach((n) => n.remove()); });
}
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, on) => {
		interface Pro { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void }
		const p = (app as unknown as { plugins: { plugins: Record<string, { pro: Pro }> } }).plugins.plugins[id]!;
		if (!on) { p.pro.signOut(); return; }
		p.pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
		await p.pro.refreshNow();
	}, pluginId, on);
}
/** Opens a saved view of the base in a new tab, so that Bases makes a new view. */
async function openInNewTab(name: string): Promise<void> {
	await browser.executeObsidian(async ({ app }, path) => { await app.workspace.openLinkText(path, '', 'tab'); }, `${BASE}#${name}`);
}
/** Cell count of the first table row, the Pro note, and the second reading of the visible view. */
async function view(): Promise<ViewState | null> {
	return browser.executeObsidian(({ app }, id) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { views: Set<{ containerEl: HTMLElement }> }> } }).plugins.plugins[id];
		const v = [...(plugin?.views ?? [])].filter((v) => v.containerEl.isConnected && v.containerEl.offsetParent !== null).pop();
		const row = v?.containerEl.querySelectorAll('tbody tr')[1];
		if (!v || !row) return null;
		return { cells: row.querySelectorAll('td').length, pro: v.containerEl.querySelector('.brd-pro-note') !== null, value: row.querySelectorAll('td')[1]?.textContent ?? '' };
	}, pluginId);
}

describe(`${pluginId} Pro notice`, function () {
	after(async function () { await setPro(false); });

	it('shows the Sponsor on GitHub button once when a free user opens a view with Pro options', async function () {
		await setPro(false);
		await clearNotices();
		await openInNewTab('Several');
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(LEAD)), { timeout: 15000 }).catch(async () => {
			throw new Error(`No Pro notice for the Several view: ${JSON.stringify({ view: await view(), notices: await notices() })}`);
		});
		const shown = (await notices()).filter((n) => n.text.includes(LEAD));
		expect(shown).toHaveLength(1);
		expect(shown[0]!.text).toContain(`${LEAD} ${PITCH}`);
		expect(shown[0]!.buttons).toBe(1);
		const v = await view();
		expect(v?.cells).toBe(4);
		expect(v?.pro).toBe(true);
		// The button opens the Sponsors page. window.open is replaced for this click only, so no page opens.
		const url = await browser.execute(() => {
			const w = window as unknown as { open: (u?: string) => unknown; activeWindow: Window };
			const original = w.open;
			let opened = '';
			w.open = (u?: string) => { opened = u ?? ''; return null; };
			try {
				(w.activeWindow.document.querySelector('.notice .pf-pro-notice-sponsor') as HTMLElement).click();
			} finally {
				w.open = original;
			}
			return opened;
		});
		expect(url).toBe(`https://github.com/sponsors/theluckystrike?frequency=one-time&metadata_source=${pluginId}`);
	});

	it('does not show the notice again when Bases sends new data for the same options', async function () {
		await clearNotices();
		const before = await obsidianPage.read(NOTE);
		try {
			await obsidianPage.write(NOTE, before.replace('reading: 13', 'reading: 14'));
			await browser.waitUntil(async () => (await view())?.value === '14', { timeout: 15000, timeoutMsg: `The view did not read the new value: ${JSON.stringify(await view())}` });
			// Give a late notice time to show before the check.
			await browser.pause(1000);
			expect((await notices()).filter((n) => n.text.includes(LEAD))).toHaveLength(0);
		} finally {
			await obsidianPage.write(NOTE, before);
			await browser.waitUntil(async () => (await view())?.value === '13', { timeout: 15000, timeoutMsg: 'The view did not read the restored value.' });
		}
	});

	it('shows no Pro notice to a Pro user (simulated Sponsors check)', async function () {
		await setPro(true);
		await clearNotices();
		await openInNewTab('Several');
		await browser.waitUntil(async () => (await view())?.cells === 10, { timeout: 15000, timeoutMsg: `Pro columns did not appear: ${JSON.stringify(await view())}` });
		await browser.pause(1000);
		expect((await notices()).filter((n) => n.text.includes(LEAD) || n.buttons > 0)).toHaveLength(0);
	});
});
