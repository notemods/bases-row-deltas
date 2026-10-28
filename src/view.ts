import { BasesView, DateValue, NumberValue, type BasesAllOptions, type BasesPropertyId, type BasesViewConfig, type QueryController, type Value } from 'obsidian';
import { compareGroups, priorOffset, RESULT_NOTICE, validNumber } from './model';
import { isPro, onProChange, proNotice } from './pro';
import type BasesRowDeltasPlugin from './main';

export const VIEW_ID = 'bases-row-deltas';
export const PRO_LEAD = 'Second and third properties, row offsets and change per day are Pro features.';
export const KEY = { number: 'deltaNumber', second: 'deltaSecond', third: 'deltaThird', offset: 'deltaOffset', date: 'deltaDate' } as const;
export function viewOptions(_config: BasesViewConfig): BasesAllOptions[] {
	return [
		{ type: 'property', key: KEY.number, displayName: 'Number property', placeholder: 'Select a number property or formula' },
		{ type: 'group', displayName: 'Pro', items: [
			{ type: 'property', key: KEY.second, displayName: 'Second number property (Pro)' },
			{ type: 'property', key: KEY.third, displayName: 'Third number property (Pro)' },
			{ type: 'slider', key: KEY.offset, displayName: 'Prior-row offset (Pro)', default: 1, min: 1, max: 100, step: 1 },
			{ type: 'property', key: KEY.date, displayName: 'Date property for change per day (Pro)' },
		] },
	];
}
/** NumberValue has no public value field. Text that looks numeric stays invalid. */
export function readNumber(value: Value | null): number | null {
	return value instanceof NumberValue ? validNumber(Number(value.toString())) : null;
}
/** Use an actual Bases date value. Text properties are not converted to dates. */
export function readDate(value: Value | null): number | null {
	if (!(value instanceof DateValue)) return null;
	const text = value.toString();
	return validNumber(Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text));
}
export class RowDeltasView extends BasesView {
	type = VIEW_ID;
	readonly containerEl: HTMLElement;
	private readonly plugin: BasesRowDeltasPlugin;
	constructor(controller: QueryController, containerEl: HTMLElement, plugin: BasesRowDeltasPlugin) {
		super(controller);
		this.plugin = plugin;
		containerEl.querySelectorAll('.brd-stale').forEach((el) => el.remove());
		this.containerEl = containerEl.createDiv({ cls: 'bases-row-deltas' });
		this.registerDomEvent(this.containerEl, 'click', (event) => {
			const target = event.targetNode;
			const link = target?.instanceOf(Element) ? target.closest<HTMLAnchorElement>('a[data-brd-path]') : null;
			if (!link || !this.containerEl.contains(link)) return;
			event.preventDefault();
			event.stopPropagation();
			const file = this.app.vault.getFileByPath(link.dataset.brdPath ?? '');
			if (file) void this.app.workspace.getLeaf(event.ctrlKey || event.metaKey).openFile(file).catch((error: unknown) => console.error('Bases Row Deltas could not open the note.', error));
		});
		plugin.views.add(this);
		this.register(() => { plugin.views.delete(this); this.containerEl.remove(); });
		this.register(onProChange(() => this.onDataUpdated()));
	}
	onDataUpdated(): void {
		if (!this.containerEl.parentElement) return;
		this.containerEl.empty();
		this.containerEl.createEl('p', { text: RESULT_NOTICE, cls: 'brd-notice' });
		if (!this.config || !this.data) return;
		this.containerEl.dataset.brdView = this.config.name;
		const primary = this.config.getAsPropertyId(KEY.number);
		if (!primary) {
			this.containerEl.createEl('p', { text: 'Select a number property in the view options. Number formulas are also supported.' });
			return;
		}
		const pro = isPro();
		const extra = [this.config.getAsPropertyId(KEY.second), this.config.getAsPropertyId(KEY.third)];
		const properties = [...new Set([primary, ...(pro ? extra : [])].filter((p): p is BasesPropertyId => p !== null))];
		const date = pro ? this.config.getAsPropertyId(KEY.date) : null;
		const offset = priorOffset(this.config.get(KEY.offset), pro);
		this.containerEl.createEl('p', { text: `${this.config.getDisplayName(primary)}: compare with ${offset === 1 ? 'the prior row' : `${offset} rows earlier`} in each group.`, cls: 'brd-summary' });
		if (!pro && (extra.some(Boolean) || this.config.getAsPropertyId(KEY.date) || priorOffset(this.config.get(KEY.offset), true) > 1)) {
			this.containerEl.createEl('p', { text: 'Pro options are saved. The free view uses one number property and the prior row.', cls: 'brd-pro-note' });
			// The shared notice shows once in a session for each view name and Pro selection. The key is kept in the
			// plugin, so a new copy of the view (new tab, restored tab, embed) and new data do not show it again.
			const key = JSON.stringify([this.config.name, ...extra, this.config.getAsPropertyId(KEY.date), priorOffset(this.config.get(KEY.offset), true)]);
			if (!this.plugin.proNoticesShown.has(key)) {
				this.plugin.proNoticesShown.add(key);
				proNotice(PRO_LEAD);
			}
		}
		const groups = this.data.groupedData;
		const rows = compareGroups(groups.map((g) => g.entries.map((entry) => ({
			path: entry.file.path, name: entry.file.basename,
			values: properties.map((property) => readNumber(entry.getValue(property))),
			date: date ? readDate(entry.getValue(date)) : null,
		}))), offset);
		if (!rows.some((g) => g.length > 0)) {
			this.containerEl.createEl('p', { text: 'Bases supplied no rows. Change the filters or the limit to show notes.' });
			return;
		}
		groups.forEach((group, groupIndex) => {
			const section = this.containerEl.createDiv({ cls: 'brd-group' });
			section.createEl('p', { text: group.hasKey() ? group.key?.toString() ?? 'Group' : 'Results', cls: 'brd-group-title' });
			const scroll = section.createDiv({ cls: 'brd-scroll', attr: { tabindex: '0', role: 'region', 'aria-label': 'Row comparisons' } });
			const table = scroll.createEl('table', { cls: 'brd-table' });
			table.createEl('caption', { text: 'Number values and row changes' });
			const head = table.createEl('thead').createEl('tr');
			head.createEl('th', { text: 'Note', attr: { scope: 'col' } });
			for (const property of properties) {
				const label = this.config.getDisplayName(property);
				for (const column of ['Current', 'Prior', 'Difference', ...(date ? ['Per day'] : [])]) {
					head.createEl('th', { text: properties.length > 1 ? `${label} · ${column}` : column, attr: { scope: 'col' } });
				}
			}
			const body = table.createEl('tbody');
			for (const row of rows[groupIndex] ?? []) {
				const tr = body.createEl('tr');
				tr.createEl('td').createEl('a', { text: row.name, cls: 'internal-link', attr: { href: row.path, 'data-href': row.path, 'data-brd-path': row.path } });
				for (const cell of row.cells) {
					for (const value of [cell.current, cell.prior, cell.difference, ...(date ? [cell.perDay] : [])]) {
						tr.createEl('td', { text: value === null ? '' : String(value), cls: 'brd-number' });
					}
				}
			}
		});
	}
}
