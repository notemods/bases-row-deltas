/** Values copied from the current Bases result. A missing or invalid value is null. */
export interface RowInput {
	path: string;
	name: string;
	values: (number | null)[];
	date: number | null;
}
export interface Comparison {
	current: number | null;
	prior: number | null;
	difference: number | null;
	perDay: number | null;
}
export interface DeltaRow {
	path: string;
	name: string;
	cells: Comparison[];
}
export const RESULT_NOTICE = 'Comparisons use only the filtered and limited result set supplied by Bases. A new sequence starts in each group.';

export function validNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function priorOffset(value: unknown, pro: boolean): number {
	return pro && typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(1, Math.floor(value))) : 1;
}
/** Keep the group and row order. Missing rows occupy their original position. */
export function compareGroups(groups: RowInput[][], offset = 1): DeltaRow[][] {
	const step = priorOffset(offset, true);
	return groups.map((entries) => entries.map((row, index) => {
		const previous = entries[index - step];
		return {
			path: row.path,
			name: row.name,
			cells: row.values.map((value, column) => {
				const current = validNumber(value);
				const prior = validNumber(previous?.values[column]);
				const difference = current !== null && prior !== null ? validNumber(current - prior) : null;
				const date = validNumber(row.date);
				const priorDate = validNumber(previous?.date);
				const days = date !== null && priorDate !== null ? (date - priorDate) / 86400000 : 0;
				const perDay = difference !== null && days > 0 ? validNumber(difference / days) : null;
				return { current, prior, difference, perDay };
			}),
		};
	}));
}
