import { createConnection, ProposedFeatures, DidChangeConfigurationNotification, TextDocumentSyncKind, InitializeResult } from 'vscode-languageserver/node';

import { SettingsManager } from './settings';
import { DocumentsManager } from './documents';

// Include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

const settings = new SettingsManager();
const documents = new DocumentsManager(settings);

connection.onInitialize(params => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	settings.hasConfigurationCapability = !!capabilities.workspace?.configuration;
	settings.hasWorkspaceFolderCapability = !!capabilities.workspace?.workspaceFolders;
	settings.hasDiagnosticRelatedInformationCapability = !!capabilities.textDocument?.publishDiagnostics?.relatedInformation;

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				triggerCharacters: [ '.', ':' ],
				resolveProvider: true,
			},
			hoverProvider: true,
			documentSymbolProvider: true,
			documentHighlightProvider: true,
			signatureHelpProvider: {
				triggerCharacters: [ '(', '[', '[', '"' ],
				retriggerCharacters: [ ',' ],
			}
		},
	};
	if (settings.hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: { supported: true },
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (settings.hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	//if (settings.hasWorkspaceFolderCapability) {
	//	//connection.workspace.onDidChangeWorkspaceFolders(event => {});
	//}
});

//connection.onDidChangeWatchedFiles(change => {});

settings.listen(connection);
documents.listen(connection);
connection.listen();
