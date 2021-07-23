import { Connection, DidChangeConfigurationParams } from 'vscode-languageserver';

interface Settings {
	parse: {
		dontBother: "all" | "no diagnostics" | "only coloration",
		defaultApiVersion: '0.2.1',// | '0.2.2',
		preDefinedGlobals: string[],
	};
	trace: {
		server: 'off' | 'messages' | 'verbose',
	};
}

const defaultSettings: Settings = {
	parse: {
		dontBother: "all",
		defaultApiVersion: '0.2.1',
		preDefinedGlobals: [],
	},
	trace: {
		server: 'verbose',
	},
};
const propertiesSection = 'pico8code' as const;

export class SettingsManager extends Map<string, Settings> {

	private globalSettings = defaultSettings;
	private connection?: Connection;

	public hasConfigurationCapability = false;
	public hasWorkspaceFolderCapability = false;
	public hasDiagnosticRelatedInformationCapability = false;

	listen(connection: Connection) {
		this.connection = connection;

		connection.onDidChangeConfiguration(this.handleOnDidChangeConfiguration.bind(this));
	}

	private handleOnDidChangeConfiguration(change: DidChangeConfigurationParams) {
		if (this.hasConfigurationCapability) {
			// Reset all cached document settings
			this.clear();
		} else {
			this.globalSettings = change.settings[propertiesSection] ?? defaultSettings;
		}

		// Revalidate all open text documents
		//documents.all().forEach(...);
	}

	async getDocumentSettings(uri: string) {
		if (!this.hasConfigurationCapability)
			return this.globalSettings;

		let result = this.get(uri);
		if (!result) {
			result = await this.connection?.workspace.getConfiguration({
				scopeUri: uri,
				section: propertiesSection
			});
			if (!result)
				result = this.globalSettings;
			this.set(uri, result);
		}
		return result;
	}

}
