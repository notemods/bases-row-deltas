import { Plugin } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { bindPro, resetPro, SPONSORS } from './pro';
import { BasesRowDeltasSettingTab } from './settings';
import { RowDeltasView, VIEW_ID, viewOptions } from './view';

export default class BasesRowDeltasPlugin extends Plugin {
	pro: SponsorsManager | null = null;
	readonly views = new Set<RowDeltasView>();
	onload(): void {
		let active = true;
		this.register(() => { active = false; });
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		const tab = new BasesRowDeltasSettingTab(this.app, this);
		this.addSettingTab(tab);
		this.register(pro.onChange(() => tab.update()));
		this.registerBasesView(VIEW_ID, {
			name: 'Row deltas', icon: 'diff',
			factory: (controller, containerEl) => new RowDeltasView(controller, containerEl, this),
			options: viewOptions,
		});
		this.app.workspace.onLayoutReady(() => {
			if (!active) return;
			void this.reopenStaleBases();
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	/** Recreate a stale base tab after the plugin is reloaded. */
	async reopenStaleBases(): Promise<void> {
		for (const leaf of [...this.app.workspace.getLeavesOfType('bases'), ...this.app.workspace.getLeavesOfType('markdown')]) {
			const el = leaf.view.containerEl;
			if (!el.querySelector('.bases-row-deltas, .brd-stale') || [...this.views].some((v) => el.contains(v.containerEl))) continue;
			const state = leaf.getViewState();
			if (state.type === 'markdown' && state.state?.mode !== 'preview') continue;
			await leaf.setViewState({ type: 'empty' });
			await leaf.setViewState(state);
		}
	}
	onunload(): void {
		for (const view of [...this.views]) {
			// Keep an empty marker so the saved view can reload with its leaf.
			const marker = view.containerEl.createDiv({ cls: 'brd-stale' });
			view.containerEl.replaceWith(marker);
			view.unload();
		}
		resetPro();
	}
}
