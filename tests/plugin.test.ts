import { afterEach, describe, expect, it, vi } from 'vitest';

// The shared Pro notice is a spy here; the e2e test checks the real notice and its Sponsor on GitHub button.
const { showProNotice } = vi.hoisted(() => ({ showProNotice: vi.fn() }));
vi.mock('../src/license/github-obsidian', async (importOriginal) => ({ ...(await importOriginal<object>()), showProNotice }));
import { App, BooleanValue, DateValue, NumberValue, StringValue } from 'obsidian-test-mocks/obsidian';
import BasesRowDeltasPlugin from '../src/main';
import { bindPro, isPro, onProChange, resetPro, SPONSORS } from '../src/pro';
import { KEY, PRO_LEAD, readDate, readNumber, RowDeltasView, viewOptions } from '../src/view';
import { compareGroups, priorOffset, RESULT_NOTICE, validNumber } from '../src/model';
import manifest from '../manifest.json';
import { BasesRowDeltasSettingTab } from '../src/settings';

const openViews: RowDeltasView[] = [];
afterEach(() => { for (const v of openViews.splice(0)) v.unload(); resetPro(); vi.restoreAllMocks(); });
function manager(start: boolean) {
	let pro = start;
	const listeners = new Set<() => void>();
	// getState, hasToken, isChecking and config serve the shared Pro notice (proNoticeKind, sponsorUrl).
	return { isPro: () => pro, getState: () => ({ status: pro ? 'pro' : 'unchecked', lastAttemptAt: 1 }), hasToken: () => false, isChecking: () => false, config: SPONSORS, onChange: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, set: (value: boolean) => { pro = value; for (const cb of listeners) cb(); } };
}
function view(values: unknown[][] = [[10,13,9]], shared?: BasesRowDeltasPlugin) {
	const app = App.createConfigured__();
	const plugin = shared ?? new BasesRowDeltasPlugin(app as never, manifest as never);
	const parent = document.createElement('div');
	const v = new RowDeltasView({} as never, parent, plugin);
	openViews.push(v);
	v.load();
	v.config.set(KEY.number, 'note.amount');
	function replace(groups: unknown[][]) {
		v.data = { groupedData: groups.map((g, n) => ({
			key: StringValue.create__(`Group ${n}`), hasKey: () => true,
			entries: g.map((amount, i) => ({
				file: { path: `Group ${n}/Row ${i}.md`, basename: `Row ${i}` },
				getValue: (property: string) => property === 'note.date' ? DateValue.parseFromString(`2026-10-${String(i * 2 + 1).padStart(2, '0')}`) : typeof amount === 'number' ? NumberValue.create__(property === 'note.other' ? amount * 2 : amount) : typeof amount === 'string' ? StringValue.create__(amount) : null,
			})),
		})) } as never;
		v.onDataUpdated();
	}
	replace(values);
	return { v, plugin, replace, cells: () => Array.from(v.containerEl.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent)) };
}

describe('Bases values and arithmetic', () => {
	it('accepts finite NumberValue and rejects text, absent, NaN and infinity', () => {
		expect(readNumber(NumberValue.create__(0) as never)).toBe(0);
		expect(readNumber(NumberValue.create__(-2.5) as never)).toBe(-2.5);
		for (const value of [null, BooleanValue.create__(true), StringValue.create__('12'), NumberValue.create__(NaN), NumberValue.create__(Infinity)]) expect(readNumber(value as never)).toBeNull();
	});
	it('reads date values but leaves date text invalid', () => {
		expect(readDate(DateValue.parseFromString('2026-10-01') as never)).toBe(Date.parse('2026-10-01T00:00:00'));
		expect(readDate(StringValue.create__('2026-10-01') as never)).toBeNull();
	});
	it('bounds the Pro offset and ignores it without Pro', () => {
		expect(priorOffset(50, false)).toBe(1);
		expect(priorOffset(1000, true)).toBe(100);
		for (const bad of [NaN, Infinity, null, '2', 0, -5]) expect(priorOffset(bad, true)).toBe(1);
		expect(priorOffset(2.8, true)).toBe(2);
	});
	it('rejects non-finite arithmetic and preserves input', () => {
		const rows = [[{path:'a',name:'a',values:[-1e308],date:null},{path:'b',name:'b',values:[1e308],date:null}]];
		const before = structuredClone(rows);
		expect(compareGroups(rows)[0]![1]!.cells[0]!.difference).toBeNull();
		expect(rows).toEqual(before);
		expect(validNumber(Infinity)).toBeNull();
	});
});
describe('view rendering', () => {
	it('shows values and differences and resets at each group', () => {
		const x = view([[10,13,9],[100,90]]);
		expect(x.cells()).toEqual([['Row 0','10','',''],['Row 1','13','10','3'],['Row 2','9','13','-4'],['Row 0','100','',''],['Row 1','90','100','-10']]);
		expect(x.v.containerEl.textContent).toContain(RESULT_NOTICE);
	});
	it('does not skip missing rows or convert numeric text', () => {
		expect(view([[10,null,14,15]]).cells().map((r) => r[3])).toEqual(['','','','1']);
		expect(view([[10,'12',15]]).cells().map((r) => r[3])).toEqual(['','','']);
	});
	it('replaces old entries and uses formula property ids', () => {
		const x = view();
		x.v.config.set(KEY.number,'formula.total');
		x.replace([[9,13,10]]);
		expect(x.cells().map((r) => r[3])).toEqual(['','4','-3']);
		expect(x.cells()).toHaveLength(3);
	});
	it('links the full path to the correct note', () => {
		const x = view();
		const file = x.v.data.groupedData[0]!.entries[0]!.file;
		vi.spyOn(x.v.app.vault, 'getFileByPath').mockReturnValue(file);
		const open = vi.fn().mockResolvedValue(undefined);
		const leaf = vi.spyOn(x.v.app.workspace, 'getLeaf').mockReturnValue({ openFile: open } as never);
		x.v.containerEl.querySelector('a')!.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));
		expect(leaf).toHaveBeenCalledWith(true);
		expect(open).toHaveBeenCalledWith(file);
	});
	it('keeps text as text and handles empty data and missing selection', () => {
		const x = view([]);
		expect(x.v.containerEl.textContent).toContain('Bases supplied no rows');
		x.v.config.set(KEY.number,null);
		x.v.onDataUpdated();
		expect(x.v.containerEl.textContent).toContain('Select a number property');
	});
	it('ignores Pro options when signed out and redraws when state changes', () => {
		const m = manager(false); bindPro(m as never);
		const x = view([[10,13,16]]);
		x.v.config.set(KEY.second,'note.other'); x.v.config.set(KEY.offset,2); x.v.config.set(KEY.date,'note.date'); x.v.onDataUpdated();
		expect(x.cells()[2]).toEqual(['Row 2','16','13','3']);
		expect(x.v.containerEl.textContent).toContain('Pro options are saved');
		m.set(true);
		expect(x.cells()[2]).toEqual(['Row 2','16','10','6','1.5','32','20','12','3']);
		m.set(false);
		expect(x.cells()[2]).toEqual(['Row 2','16','13','3']);
	});
	it('shows the Pro notice once for each new Pro selection of a free user, not on each data update', () => {
		bindPro(manager(false) as never);
		const x = view([[10,13,16]]);
		showProNotice.mockClear();
		x.v.onDataUpdated();
		expect(showProNotice).not.toHaveBeenCalled();
		x.v.config.set(KEY.second,'note.other'); x.v.onDataUpdated();
		expect(showProNotice).toHaveBeenCalledTimes(1);
		expect(showProNotice.mock.calls[0]![1]).toBe(PRO_LEAD);
		x.v.onDataUpdated(); x.v.onDataUpdated();
		expect(showProNotice).toHaveBeenCalledTimes(1);
		x.v.config.set(KEY.offset,2); x.v.onDataUpdated();
		expect(showProNotice).toHaveBeenCalledTimes(2);
	});
	it('shows one Pro notice for three copies of the same view with the same Pro options', () => {
		bindPro(manager(false) as never);
		const first = view([[10,13,16]]);
		showProNotice.mockClear();
		for (const x of [first, view([[10,13,16]], first.plugin), view([[10,13,16]], first.plugin)]) {
			x.v.config.set(KEY.second,'note.other'); x.v.onDataUpdated(); x.v.onDataUpdated();
			expect(x.v.containerEl.textContent).toContain('Pro options are saved');
		}
		expect(showProNotice).toHaveBeenCalledTimes(1);
	});
	it('shows no Pro notice to a Pro user', () => {
		bindPro(manager(true) as never);
		const x = view([[10,13,16]]);
		showProNotice.mockClear();
		x.v.config.set(KEY.second,'note.other'); x.v.onDataUpdated();
		expect(showProNotice).not.toHaveBeenCalled();
	});
	it('deduplicates selected properties and removes the view on unload', () => {
		bindPro(manager(true) as never);
		const x = view(); x.v.config.set(KEY.second,'note.amount'); x.v.onDataUpdated();
		expect(x.cells()[0]).toHaveLength(4);
		x.v.unload(); expect(x.plugin.views.size).toBe(0);
	});
});
describe('Pro facade and view options', () => {
	it('uses the required GitHub Sponsors configuration', () => {
		expect(SPONSORS).toMatchObject({clientId:'Ov23lic5UPGPZqhBlBGg',sponsorLogin:'theluckystrike',minMonthlyUsd:5,oneTimeUsd:15,oneTimeMonths:0,scope:'read:user'});
		expect(isPro()).toBe(false);
	});
	it('unbinds listeners and resets the manager', () => {
		const m = manager(false); bindPro(m as never); const listener = vi.fn(); const off = onProChange(listener);
		m.set(true); expect(isPro()).toBe(true); expect(listener).toHaveBeenCalledTimes(1);
		off(); m.set(false); expect(listener).toHaveBeenCalledTimes(1); resetPro(); expect(isPro()).toBe(false);
	});
	it('uses public property pickers and a separate Pro group', () => {
		const options=viewOptions({} as never);
		expect(options[0]).toMatchObject({type:'property',key:KEY.number});
		expect(options[1]).toMatchObject({type:'group',displayName:'Pro'});
	});
});

describe('review regressions', () => {
	it('releases view resources when the plugin unloads', () => {
		const x = view();
		const link = x.v.containerEl.querySelector('a')!;
		const lookup = vi.spyOn(x.v.app.vault, 'getFileByPath');
		x.plugin.onunload();
		expect(x.plugin.views.size).toBe(0);
		expect(x.v.containerEl.parentElement).toBeNull();
		link.click();
		expect(lookup).not.toHaveBeenCalled();
	});
	it('uses local midnight for date-only and datetime values on the same day', () => {
		const date = readDate(DateValue.parseFromString('2026-10-01') as never);
		const midnight = readDate(DateValue.parseFromString('2026-10-01T00:00:00') as never);
		expect(date).toBe(midnight);
	});
	it('does not start layout work after the plugin unloads', () => {
		const app = App.createConfigured__();
		let ready: () => unknown = () => undefined;
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((cb) => { ready = cb; });
		const plugin = new BasesRowDeltasPlugin(app as never, manifest as never);
		const reopen = vi.spyOn(plugin, 'reopenStaleBases').mockResolvedValue(undefined);
		const interval = vi.spyOn(window, 'setInterval');
		plugin.load();
		plugin.unload();
		try {
			ready();
			expect(reopen).not.toHaveBeenCalled();
			expect(interval).not.toHaveBeenCalled();
		} finally {
			for (const result of interval.mock.results) if (result.type === 'return') window.clearInterval(result.value as number);
			vi.restoreAllMocks();
		}
	});
	it('opens the exact file when a note name contains a hash', () => {
		const x = view([[10]]);
		const file = { path: 'Group 0/Reading # one.md', basename: 'Reading # one' };
		const group = x.v.data.groupedData[0]!;
		group.entries[0]!.file = file as never;
		x.v.onDataUpdated();
		const lookup = vi.spyOn(x.v.app.vault, 'getFileByPath').mockReturnValue(file as never);
		const openFile = vi.fn().mockResolvedValue(undefined);
		const getLeaf = vi.spyOn(x.v.app.workspace, 'getLeaf').mockReturnValue({ openFile } as never);
		x.v.containerEl.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
		expect(lookup).toHaveBeenCalledWith(file.path);
		expect(getLeaf).toHaveBeenCalledWith(true);
		expect(openFile).toHaveBeenCalledWith(file);
		vi.restoreAllMocks();
	});
	it('does not add a heading for a single settings section', () => {
		const app = App.createConfigured__();
		const plugin = new BasesRowDeltasPlugin(app as never, manifest as never);
		plugin.load();
		try {
			const tab = new BasesRowDeltasSettingTab(app as never, plugin);
			// The product rows have no heading. The shared "More from NoteMods" card after them has its own heading.
			expect(tab.productSettingDefinitions().some((item) => 'heading' in item)).toBe(false);
		} finally { plugin.unload(); }
	});
});

describe('review claim checks', () => {
	it('renders a 5000-row result and then an empty result', () => {
		const x = view([Array.from({ length: 5000 }, (_, i) => i)]);
		expect(x.cells()).toHaveLength(5000);
		expect(x.cells()[4999]).toEqual(['Row 4999', '4999', '4998', '1']);
		x.replace([]);
		expect(x.cells()).toEqual([]);
	});
	it('renders note names as text and removes note handlers on unload', () => {
		const x = view([[10]]);
		x.v.data.groupedData[0]!.entries[0]!.file.basename = '<img src=x onerror=alert(1)>';
		x.v.onDataUpdated();
		const link = x.v.containerEl.querySelector('a')!;
		expect(link.textContent).toBe('<img src=x onerror=alert(1)>');
		expect(link.querySelector('img')).toBeNull();
		const lookup = vi.spyOn(x.v.app.vault, 'getFileByPath');
		x.v.unload();
		link.click();
		expect(lookup).not.toHaveBeenCalled();
	});
	it('does not send sponsorship requests while signed out', async () => {
		const app = App.createConfigured__();
		const plugin = new BasesRowDeltasPlugin(app as never, manifest as never);
		plugin.load();
		try {
			const http = vi.fn();
			(plugin.pro as unknown as { opts: { http: unknown } }).opts.http = http;
			await plugin.pro!.refresh();
			await plugin.pro!.refreshNow();
			expect(isPro()).toBe(false);
			expect(http).not.toHaveBeenCalled();
		} finally { plugin.unload(); }
	});
});
