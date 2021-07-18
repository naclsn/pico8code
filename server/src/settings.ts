import { Connection, DidChangeConfigurationParams } from 'vscode-languageserver';

interface Settings {
	parse: {
		defaultApiVersion: '0.2.1' | '0.2.2',
		preDefinedGlobals: string[],
	};
	trace: {
		server: 'off' | 'messages' | 'verbose',
	};
}

const defaultSettings: Settings = {
	parse: {
		defaultApiVersion: '0.2.1',
		preDefinedGlobals: [],
	},
	trace: {
		server: 'verbose',
	},
};
const propertiesSection = 'pico8Language' as const;

/*// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function 

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});
*/
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
		//documents.all().forEach(validateTextDocument);
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
