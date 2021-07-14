import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';

import {
	Position,
	TextDocument
} from 'vscode-languageserver-textdocument';
import parser = require('pico8parse');

// Include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);
// Simple text document manager.
const documents = new TextDocuments(TextDocument);

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
				resolveProvider: true
			},
			hoverProvider: true
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
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
			connection.console.log("Workspace folder change event received:");
			connection.console.log(" + '" + event.added.join("', '") + "'");
			connection.console.log(" - '" + event.removed.join("', '") + "'");
		});
	}
});

documents.onDidChangeContent(change => {
	connection.console.log("We received a content update");
	updateTextDocument(change.document);
});

connection.onDidChangeWatchedFiles(change => {
	connection.console.log("We received a file change event:");
	connection.console.log(change.changes.length + " changes");
	change.changes.forEach(it => connection.console.log(` * (${it.type}) ${it.uri}`));
});

// Provide the initial list of the completion items.
connection.onCompletion(textDocumentPosition => {
	connection.console.log("We received a completion request:");
	connection.console.log(" @ " + textDocumentPosition.textDocument.uri + ":" + textDocumentPosition.position.line + ":" + textDocumentPosition.position.character);
	const items: CompletionItem[] = [
		{
			label: "TypeScript",
			kind: CompletionItemKind.Text,
			data: 1
		},
		{
			label: "JavaScript",
			kind: CompletionItemKind.Text,
			data: 2
		}
	];
	return items;
});

// Resolve additional information for the item selected.
connection.onCompletionResolve(item => {
	connection.console.log("We received a completion _resolve_ request:");
	if (item.data === 1) {
		item.detail = "TypeScript details";
		item.documentation = "TypeScript documentation";
	} else if (item.data === 2) {
		item.detail = "JavaScript details";
		item.documentation = "JavaScript documentation";
	}
	return item;
});

connection.onHover(textDocumentPosition => {
	connection.console.log("Hovering somewhere");
	connection.console.log(JSON.stringify(textDocumentPosition.position));

	const document = documentCache[textDocumentPosition.textDocument.uri];
	if (!document) return null;
	const foundItem = selectItem(document, textDocumentPosition.position);

	return !foundItem ? null : {
		contents: {
			kind: 'plaintext',
			value: foundItem.hover.join("\n"),
		},
		range: {
			start: foundItem.range[0],
			end: foundItem.range[1],
		}
	};
});

documents.listen(connection);
connection.listen();

// ---

type Item = { range: [start: Position,end: Position], hover: string[] };
type CachedDocument = { ast: parser.ast.Chunk, items: Item[] };
const documentCache: Record<string, CachedDocument|undefined> = {};

async function updateTextDocument(textDocument: TextDocument): Promise<void> {
	const text = textDocument.getText();
	const diagnostics: Diagnostic[] = [];

	const document = documentCache[textDocument.uri] ?? { ast: {body:[],type:'Chunk'}, items: [] };

	try {
		connection.console.log(`Trying to parse document ${textDocument.uri}`);
		document.ast = parser.parse(text, { ranges: true, luaVersion: 'PICO-8-0.2.1' });
		connection.console.log("Parsing done - caching items");
		updateCacheItems(document, o => textDocument.positionAt(o));
		connection.console.log(`Found ${document.items.length} items`);
	} catch (err) {
		if (err instanceof parser.SyntaxError)
			diagnostics.push({
				message: `${err.name}: ${err.message}`,
				range: {
					start: textDocument.positionAt(0),
					end: textDocument.positionAt(text.length-1),
				},
			});
		else throw err;
	}

	documentCache[textDocument.uri] = document;
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

function selectItem(documentFor: CachedDocument, at: Position): Item | null {
	if (!documentFor) return null;

	const { items } = documentFor;
	for (let k = 0; k < items.length; k++) {
		const [start, end] = items[k].range;
		if (start.line <= at.line && at.line <= end.line)
			if (start.character <= at.character && at.character <= end.character) {
				connection.console.log("Maybe found something:");
				connection.console.log("\t" + JSON.stringify(start));
				connection.console.log("\t" + JSON.stringify(end));
				return items[k];
			}
	}

	return null;
}

function updateCacheItems(documentFor: CachedDocument, positionAt: (offset: number) => Position) {
	const { ast, items } = documentFor;
	items.length = 0;
	const zero = positionAt(0);

	discover(...ast.body);

	function discover(...nodes: (parser.ast.Node | null)[]) {
		for (let k = 0; k < nodes.length; k++) {
			const s = nodes[k];
			if (!s) continue;
			switch (s.type) {
				case 'Identifier':
						items.push({
							range: s.range ? [positionAt(s.range[0]), positionAt(s.range[1])] : [zero, zero],
							hover: [ `(${s.isLocal ? "local" : "global"}) ${s.name}: any`, JSON.stringify(s) ],
						});
					break;
				case 'LabelStatement':
						discover(s.label); // Identifier;
					break;
				case 'GotoStatement':
						discover(s.label); // Identifier;
					break;
				case 'ReturnStatement':
						discover(...s.arguments); // Expression[];
					break;
				case 'IfStatement':
						discover(...s.clauses); // IfStatementClauses;
					break;
				case 'IfClause':
						discover(s.condition); // Expression;
						discover(...s.body); // Statement[];
					break;
				case 'ElseifClause':
						discover(s.condition); // Expression;
						discover(...s.body); // Statement[];
					break;
				case 'ElseClause':
						discover(...s.body); // Statement[];
					break;
				case 'WhileStatement':
						discover(s.condition); // Expression;
						discover(...s.body); // Statement[];
					break;
				case 'DoStatement':
						discover(...s.body); // Statement[];
					break;
				case 'RepeatStatement':
						discover(s.condition); // Expression;
						discover(...s.body); // Statement[];
					break;
				case 'LocalStatement':
						discover(...s.variables); // Identifier[];
						discover(...s.init); // Expression[];
					break;
				case 'AssignmentStatement':
						discover(...s.variables); // Array<IndexExpression | MemberExpression | Identifier>;
						discover(...s.init); // Expression[];
					break;
				case 'AssignmentOperatorStatement':
						discover(...s.variables); // Array<IndexExpression | MemberExpression | Identifier>;
						discover(...s.init); // Expression[];
					break;
				case 'CallStatement':
						discover(s.expression); // CallExpression | StringCallExpression | TableCallExpression;
					break;
				case 'FunctionDeclaration':
						discover(s.identifier); // Identifier | MemberExpression | null;
						discover(...s.parameters); // Array<Identifier | VarargLiteral>;
						discover(...s.body); // Statement[];
					break;
				case 'ForNumericStatement':
						discover(s.variable); // Identifier;
						discover(s.start); // Expression;
						discover(s.end); // Expression;
						discover(s.step); // Expression | null;
						discover(...s.body); // Statement[];
					break;
				case 'ForGenericStatement':
						discover(...s.variables); // Identifier[];
						discover(...s.iterators); // Expression[];
						discover(...s.body); // Statement[];
					break;
				case 'TableKey':
						discover(s.key); // Expression;
						discover(s.value); // Expression;
					break;
				case 'TableKeyString':
						discover(s.key); // Identifier;
						discover(s.value); // Expression;
					break;
				case 'TableValue':
						discover(s.value); // Expression;
					break;
				case 'TableConstructorExpression':
						discover(...s.fields); // Array<TableKey | TableKeyString | TableValue>;
					break;
				case 'UnaryExpression':
						discover(s.argument); // Expression;
					break;
				case 'BinaryExpression':
						discover(s.left); // Expression;
						discover(s.right); // Expression;
					break;
				case 'LogicalExpression':
						discover(s.left); // Expression;
						discover(s.right); // Expression;
					break;
				case 'MemberExpression':
						discover(s.identifier); // Identifier;
						discover(s.base); // Expression;
					break;
				case 'IndexExpression':
						discover(s.base); // Expression;
						discover(s.index); // Expression;
					break;
				case 'CallExpression':
						discover(s.base); // Expression;
						discover(...s.arguments); // Expression[];
					break;
				case 'TableCallExpression':
						discover(s.base); // Expression;
						discover(s.argument); // Expression;
					break;
				case 'StringCallExpression':
						discover(s.base); // Expression;
						discover(s.argument); // Expression;
					break;
				case 'Chunk':
				case 'StringLiteral':
				case 'NumericLiteral':
				case 'BooleanLiteral':
				case 'NilLiteral':
				case 'VarargLiteral':
				case 'Comment':
					break;
				default:
					throw Error(`Unknown node type: ${s.type} at [${s.range?.join(":")}]`);
			}
		}
	}
}
