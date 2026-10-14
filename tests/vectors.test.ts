import { describe, expect, it } from 'vitest';
import vectors from './vectors/bases-row-deltas.json';
import { compareGroups, type RowInput } from '../src/model';

describe('golden acceptance vectors', () => {
	it('has at least 20 vectors', () => expect(vectors.cases.length).toBeGreaterThanOrEqual(20));
	for (const c of vectors.cases) it(c.name, () => {
		const [groups, offset] = c.args as [RowInput[][], number];
		expect(compareGroups(groups, offset)).toEqual(c.expected);
	});
});
