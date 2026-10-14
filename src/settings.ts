import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import type BasesRowDeltasPlugin from './main';

export class BasesRowDeltasSettingTab extends PluginSettingTab {
	plugin: BasesRowDeltasPlugin;
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: BasesRowDeltasPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		const items = this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : [];
		return items.flatMap((item) => 'type' in item && item.type === 'group' ? item.items ?? [] : [item]);
	}
}
