import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { pluginId, reloadPlugin } from './load';
const BASE = 'Bases Row Deltas/Readings.base';
const NOTE = 'Bases Row Deltas/Notes/North 02.md';
interface State {
	name: string;
	groups: { title: string; cells: string[][] }[];
	supplied: { title: string; names: string[] }[];
	notice: string;
	proNote: boolean;
}
async function state(): Promise<State | null> {
	return browser.executeObsidian(({ app }, id) => {
		interface V {
			containerEl: HTMLElement;
			config: { name: string };
			data: { groupedData: { key?: { toString(): string }; hasKey(): boolean; entries: { file: { basename: string } }[] }[] };
		}
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { views: Set<V> }> } }).plugins.plugins[id];
		const v = [...(plugin?.views ?? [])].filter((v) => v.containerEl.isConnected && v.containerEl.offsetParent !== null).pop();
		if (!v?.data) return null;
		return {
			name: v.containerEl.dataset.brdView ?? '',
			groups: Array.from(v.containerEl.querySelectorAll('.brd-group')).map((el) => ({ title: el.querySelector('.brd-group-title')?.textContent ?? '', cells: Array.from(el.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '')) })),
			supplied: v.data.groupedData.map((g) => ({title:g.hasKey() ? g.key?.toString() ?? 'Group' : 'Results',names:g.entries.map((e) => e.file.basename)})),
			notice: v.containerEl.querySelector('.brd-notice')?.textContent ?? '',
			proNote: v.containerEl.querySelector('.brd-pro-note') !== null,
		};
	}, pluginId);
}
async function waitFor(pred: (s: State) => boolean, message: string): Promise<State> {
	let last: State | null = null;
	await browser.waitUntil(async () => { last = await state(); return last !== null && pred(last); }, {timeout:30000,interval:200,timeoutMsg:message});
	return last!;
}
async function open(name: string, count: number): Promise<State> {
	await browser.executeObsidian(async ({ app }, path) => { await app.workspace.openLinkText(path,'',false); }, `${BASE}#${name}`);
	return waitFor((s) => s.name === name && s.groups.flatMap((g) => g.cells).length === count, `View ${name} did not supply ${count} rows`);
}
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, on) => {
		interface Pro { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void }
		const p = (app as unknown as {plugins:{plugins:Record<string,{pro:Pro}>}}).plugins.plugins[id]!;
		if (!on) { p.pro.signOut(); return; }
		p.pro.opts.http = async () => ({status:200,json:{data:{viewer:{login:'demo-reader'},user:{sponsorshipForViewerAsSponsor:{isActive:true,isOneTimePayment:false,tier:{name:'$5 a month',monthlyPriceInCents:500}}}}}});
		app.secretStorage.setSecret(`${id}-github-token`,'gho_'+'0'.repeat(36));
		await p.pro.refreshNow();
	},pluginId,on);
}
describe('Row deltas in the app', function () {
	before(async function () { await setPro(false); });
	after(async function () { await setPro(false); });
	it('shows grouped rows without crossing a group boundary', async function () {
		const s = await open('Groups',5);
		expect(s.groups.find((g) => g.title === 'North')!.cells).toEqual([['North 01','10','',''],['North 02','13','10','3'],['North 03','9','13','-4']]);
		expect(s.groups.find((g) => g.title === 'South')!.cells).toEqual([['South 01','100','',''],['South 02','90','100','-10']]);
		expect(s.notice).toContain('filtered and limited result set');
	});
	it('keeps a missing row in place', async function () {
		expect((await open('Gaps',4)).groups[0]!.cells.map((r) => r[3])).toEqual(['','','','1']);
	});
	it('uses only the limited result set', async function () {
		expect((await open('Limited',2)).groups[0]!.cells).toEqual([['North 02','13','',''],['North 03','9','13','-4']]);
	});
	it('replaces formula values after a source property changes', async function () {
		await open('Formula',3);
		const before = await obsidianPage.read(NOTE);
		try {
			await obsidianPage.write(NOTE,before.replace('reading: 13','reading: 17'));
			const s = await waitFor((s) => s.name === 'Formula' && s.groups[0]?.cells[1]?.[1] === '34','Updated formula value did not appear');
			expect(s.groups[0]!.cells.map((r) => r[3])).toEqual(['','14','-16']);
		} finally { await obsidianPage.write(NOTE,before); }
		await waitFor((s) => s.groups[0]?.cells[1]?.[1] === '26','Formula restoration did not appear');
	});
	it('uses a changed delivered order without changing source notes', async function () {
		await open('Numbers',3);
		const original = await obsidianPage.read(BASE);
		const before = await obsidianPage.read(NOTE);
		try {
			await obsidianPage.write(BASE,original.replace('direction: ASC','direction: DESC'));
			const s=await waitFor((s) => s.name === 'Numbers' && s.groups[0]?.cells[0]?.[0] === 'North 03','Descending rows did not appear');
			expect(s.groups[0]!.cells.map((r) => r[3])).toEqual(['','4','-3']);
			expect(await obsidianPage.read(NOTE)).toBe(before);
		} finally { await obsidianPage.write(BASE,original); }
	});
	it('keeps the delivered order when sort keys are equal', async function () {
		const s=await open('Ties',3);
		expect(s.groups[0]!.cells.map((r) => r[0])).toEqual(s.supplied[0]!.names);
	});
	it('uses the supplied manual group order and visible group subset', async function () {
		for (const name of ['Manual groups','Hidden groups']) {
			await browser.executeObsidian(async ({app},path) => {await app.workspace.openLinkText(path,'',false);},`${BASE}#${name}`);
			const s = await waitFor((s) => s.name === name && s.groups.length > 0,`${name} did not appear`);
			expect(s.groups.map((g) => g.title)).toEqual(s.supplied.map((g) => g.title));
			for (const g of s.groups) expect(g.cells[0]!.slice(2)).toEqual(['','']);
			// groupOrder is public from 1.14.3. Earlier Bases supplies its default order.
			const version = await browser.executeObsidian(({ obsidian }) => obsidian.apiVersion);
			if (Number(version.split('.')[1]) >= 14) expect(s.groups.map((g) => g.title)).toEqual(name === 'Manual groups' ? ['South','North','Gap'] : ['South','North']);
		}
	});
	it('gates several properties through Sponsors and redraws on sign-out', async function () {
		await setPro(false);
		let s=await open('Several',3); expect(s.proNote).toBe(true); expect(s.groups[0]!.cells[0]).toHaveLength(4);
		await setPro(true);
		s=await waitFor((s) => s.groups[0]?.cells[0]?.length === 10,'Pro columns did not appear');
		expect(s.groups[0]!.cells[1]).toEqual(['North 02','13','10','3','110','100','10','26','20','6']);
		await setPro(false);
		s=await waitFor((s) => s.groups[0]?.cells[0]?.length === 4,'Free columns did not return');
		expect(s.proNote).toBe(true);
		expect(await obsidianPage.read(BASE)).toContain('deltaSecond: note.cost');
	});
	it('uses a Pro offset of two and a date rate', async function () {
		await setPro(true);
		let s=await open('Offset',3);
		expect(s.groups[0]!.cells).toEqual([['North 01','10','',''],['North 02','13','',''],['North 03','9','10','-1']]);
		s=await open('Per day',3);
		expect(s.groups[0]!.cells.map((r) => r[4])).toEqual(['','1.5','-2']);
		const before=await obsidianPage.read(NOTE);
		try {
			await obsidianPage.write(NOTE,before.replace('day: 2026-10-03','day: 2026-10-01'));
			s=await waitFor((s) => s.groups[0]?.cells[1]?.[4] === '','Equal-date rate did not clear');
			expect(s.groups[0]!.cells[1]![3]).toBe('3');
		} finally { await obsidianPage.write(NOTE,before); }
		await setPro(false);
	});
	it('shows a saved view in a reading-mode note', async function () {
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.getLeaf(false).setViewState({
				type: 'markdown', state: { file: 'Bases Row Deltas/Review.md', mode: 'preview' },
			});
		});
		const s = await waitFor((s) => s.name === 'Groups' && s.groups.flatMap((g) => g.cells).length === 5,
			'The saved view did not render in the note');
		expect(s.groups.find((g) => g.title === 'North')!.cells[1]![3]).toBe('3');
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		await waitFor((s) => s.name === 'Groups' && s.groups.flatMap((g) => g.cells).length === 5, 'The embedded view did not reload');
	});
	it('opens a note whose file name contains a hash', async function () {
		const path = 'Bases Row Deltas/Notes/Review # one.md';
		await browser.executeObsidian(async ({ app }, path) => {
			await app.vault.create(path, '---\nmeter: North\nreading: 20\nsequence: 4\n---\nReview sample.\n');
		}, path);
		try {
			await open('Numbers', 4);
			await browser.execute((path) => {
				const links = Array.from(document.querySelectorAll('.workspace-leaf.mod-active .bases-row-deltas a'));
				const link = links.find((el) => el.getAttribute('data-href') === path) as HTMLElement;
				link.click();
			}, path);
			await browser.waitUntil(async () => (await browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path)) === path,
				{ timeout: 10000, timeoutMsg: 'The hash note did not open' });
		} finally {
			await browser.executeObsidian(async ({ app }, path) => {
				const file = app.vault.getFileByPath(path);
				if (file) await app.vault.delete(file);
			}, path);
		}
	});
	it('scrolls inside a 360-pixel pane and opens a note link', async function () {
		await open('Numbers',3);
		const layout=await browser.executeObsidian(({app},id) => {
			interface V {containerEl:HTMLElement}
			const p=(app as unknown as {plugins:{plugins:Record<string,{views:Set<V>}>}}).plugins.plugins[id]!;
			const v=[...p.views].filter((v) => v.containerEl.isConnected && v.containerEl.offsetParent !== null).pop()!;
			v.containerEl.style.width='360px';v.containerEl.style.boxSizing='border-box';
			const scroll=v.containerEl.querySelector('.brd-scroll') as HTMLElement;
			scroll.scrollLeft=100;
			return {width:v.containerEl.getBoundingClientRect().width,client:scroll.clientWidth,full:scroll.scrollWidth,moved:scroll.scrollLeft};
		},pluginId);
		expect(layout.width).toBe(360);expect(layout.full).toBeGreaterThan(layout.client);expect(layout.moved).toBeGreaterThan(0);
		await browser.execute(() => {
			const scroll=document.querySelector('.workspace-leaf.mod-active .brd-scroll') as HTMLElement;scroll.scrollLeft=0;
			(document.querySelector('.workspace-leaf.mod-active .bases-row-deltas a[data-href="Bases Row Deltas/Notes/North 01.md"]') as HTMLElement).click();
		});
		await browser.waitUntil(async () => (await browser.executeObsidian(({app}) => app.workspace.getActiveFile()?.path)) === 'Bases Row Deltas/Notes/North 01.md',{timeout:10000,timeoutMsg:'Note link did not open its source'});
	});
	it('recreates an open base after reload without console errors', async function () {
		await open('Numbers',3);
		expect((await reloadPlugin(pluginId)).errors).toEqual([]);
		await waitFor((s) => s.name === 'Numbers' && s.groups[0]?.cells.length === 3,'Reloaded base did not render');
	});
});
