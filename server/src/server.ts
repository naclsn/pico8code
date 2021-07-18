import {
	createConnection,
	ProposedFeatures,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentSyncKind,
	InitializeResult,
} from 'vscode-languageserver/node';

import { DocumentManager } from './document/index';

// Include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

const documentManager = new DocumentManager();

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize(params => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				triggerCharacters: [ '.', ':' ],
				resolveProvider: true,
			},
			hoverProvider: true,
			documentSymbolProvider: true,
		},
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true,
			},
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(event => {
			//console.log("Workspace folder change event received:");
			//console.log(" + '" + event.added.join("', '") + "'");
			//console.log(" - '" + event.removed.join("', '") + "'");
		});
	}
});

/*connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.languageServerExample || defaultSettings)
		);
	}

	// Revalidate all open text documents
	//documents.all().forEach(validateTextDocument);
});*/

connection.onDidChangeWatchedFiles(change => {
	//console.log("We received a file change event:");
	//console.log(change.changes.length + " changes");
	//change.changes.forEach(it => console.log(` * (${it.type}) ${it.uri}`));
});

// Provide the initial list of the completion items.
connection.onCompletion(textDocumentPosition => {
	//console.log("We received a completion request:");
	//console.log(" @ " + textDocumentPosition.textDocument.uri + ":" + textDocumentPosition.position.line + ":" + textDocumentPosition.position.character);
	const items: CompletionItem[] = [
		{
			label: "TypeScript",
			kind: CompletionItemKind.Text,
			data: 1,
		},
		{
			label: "JavaScript",
			kind: CompletionItemKind.Text,
			data: 2,
		},
	];
	return items;
});

// Resolve additional information for the item selected.
connection.onCompletionResolve(item => {
	//console.log("We received a completion _resolve_ request:");
	if (item.data === 1) {
		item.detail = "TypeScript details";
		item.documentation = "TypeScript documentation";
	} else if (item.data === 2) {
		item.detail = "JavaScript details";
		item.documentation = "JavaScript documentation";
	}
	return item;
});

documentManager.listen(connection);
connection.listen();
