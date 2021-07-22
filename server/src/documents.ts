import { parse, Options as ParseOptions, SyntaxError as ParseError } from 'pico8parse';
import { Connection, DocumentSymbolParams, Hover, HoverParams, TextDocuments, TextDocumentChangeEvent, CompletionParams, CompletionItem as BaseCompletionItem, CompletionContext, DocumentSymbol, Diagnostic, CompletionItemKind, DocumentHighlightParams, DocumentHighlight, SignatureHelpParams, SignatureHelp, CompletionTriggerKind, SignatureHelpContext } from 'vscode-languageserver';
import { Position, Range, TextDocument } from 'vscode-languageserver-textdocument';

import { LUTFunctions, LUTScopes, LUTTables, LUTVariables, SelfExplore } from './document/explore';
import { isLuaFunction, isLuaTable, LuaDoc, LuaFunction, LuaTable, represent } from './document/typing';
import { SettingsManager } from './settings';
import { findWordRange, rangeContains, representVariableHover } from './util';

const parseOptions: Partial<ParseOptions> = {
	luaVersion: 'PICO-8-0.2.1', // XXX: from option or from p8 file header
	locations: true,
	comments: true,
};

interface CompletionItem extends BaseCompletionItem {
	data?: {
		uri: string,
		recent: Position,
	};
}

export class Document extends SelfExplore {

	constructor(public uri: string, private manager: DocumentsManager) {
		super();
	}

//#region handlers
	handleOnDidChangeContent(textDocument: TextDocument): Diagnostic[] | null {
		try {
			this.backup();
			console.log("======= Parsing document =======");
			this.reset();
			this.ast = parse(textDocument.getText(), parseOptions);
			this.explore();
			console.log("------------- done -------------");
		} catch (err) {
			this.restore();
			console.log("Parsing failed, restoring backup");
			if (err instanceof ParseError) {
				const line = err.line-1;
				const character = err.column;
				this.diagnostics.push({
					message: `${err.name}: ${err.message}`,
					range: {
						start: { line, character },
						end: { line, character },
					},
				});
			} else throw err;
		}
		return this.diagnostics;
	}

	handleOnHover(range: Range): Hover | null {
		const found = this.findVariable(range.start);
		if (!found) return null;

		return {
			contents: {
				kind: 'markdown',
				value: representVariableHover(found.scope.tag, found.name, found.type, found.doc),
			},
		};
	}

	handleOnDocumentSymbol(): DocumentSymbol[] | null {
		return this.symbols;
	}

	handleOnCompletion(position: Position, identifier: string, context?: CompletionContext): CompletionItem[] | null {
		if (CompletionTriggerKind.TriggerCharacter === context?.triggerKind) {
			let found: LuaTable | undefined;

			if (identifier) {
				const scope = this.findScope(position);
				if (!scope) return null; // XXX: always false because doesn't account for __lua__ section interruptions (ie. in __gfx__ is still in a scope)

				const variable = scope.scope.variables[identifier];
				if (!variable) return null;

				const k = 0;
				let f = false;
				while (k < variable.ranges.length) {
					if (!f) {
						const it = variable.ranges[k].start;
						f = it.line <= position.line && it.character <= position.character;
					} else {
						const it = variable.types[k];
						if (isLuaTable(it)) {
							found = it;
							break;
						}
					}
				}
				if (!found) return null;
			} else {
				const table = this.findTable(position);
				if (!table) return null;
				found = table.type;
			}

			return Object
				.entries(found.entries)
				.map(([key, type]) => ({
					label: key,
					kind: CompletionItemKind.Field,
					detail: represent(type),
				}));
		} else {
			const found = this.findScope(position);
			if (!found) return null; // XXX: always false because doesn't account for __lua__ section interruptions (ie. in __gfx__ is still in a scope)

			const list: CompletionItem[] = [];
			for (const label in found.scope.variables) {
				const it = found.scope.variables[label]!;
				list.push({
					label,
					data: {
						uri: this.uri,
						recent: it.ranges[0].start,
					},
				});
			}
			return list;
		}
	}

	handleOnCompletionResolve(item: CompletionItem): CompletionItem | null {
		if (!item.data) return null;
		const found = this.findVariable(item.data.recent);
		if (!found) return null;

		const type = found.doc?.type ?? found.type;
		item.kind = isLuaFunction(type)
			? CompletionItemKind.Function
			: isLuaTable(type)
				? CompletionItemKind.Class
				: CompletionItemKind.Variable;
		item.detail = represent(type);
		if (found.doc) item.documentation = {
			kind: 'markdown',
			value: [
				found.doc.text,
				" ",
				item.documentation,
			].join("\n"),
		};
		return item;
	}

	handleOnDocumentHighlight(range: Range): DocumentHighlight[] | null {
		const variable = this.findVariable(range.start);
		const reference = variable?.scope.variables[variable.name];
		if (!reference) return null;

		return reference.ranges.map(range => ({ range })); // TODO: kind DocumentHighlightKind.Read/Write
	}

	handleOnSignatureHelp(position: Position, identifier: string, context?: SignatureHelpContext): SignatureHelp | null {
		let found: LuaFunction | undefined;
		let doc: LuaDoc | undefined;

		if (identifier && ')' !== identifier) {
			const scope = this.findScope(position);
			if (!scope) return null; // XXX: always false because doesn't account for __lua__ section interruptions (ie. in __gfx__ is still in a scope)

			const variable = scope.scope.variables[identifier];
			if (!variable) return null;

			const k = 0;
			let f = false;
			while (k < variable.ranges.length) {
				if (!f) {
					const it = variable.ranges[k].start;
					f = it.line <= position.line && it.character <= position.character;
				} else {
					const it = variable.types[k];
					if (isLuaFunction(it)) {
						found = it;
						break;
					}
				}
			}
			if (!found) return null;
		} else {
			const fun = this.findFunction(position);
			if (!fun) return null;
			found = fun.type;
			doc = fun.doc;
		}

		return {
			signatures: [{
				label: represent(found),
				parameters: found.parameters.map(it => ({
					label: it.name,
					documentation: represent(it.type),
				})),
			}],
			activeSignature: 0,
			activeParameter: null,
		};
	}
//#endregion

//#region backup LUTs for parse failures
	private lutBackupVariables?: LUTVariables;
	private lutBackupScopes?: LUTScopes;
	private lutBackupFunctions?: LUTFunctions;
	private lutBackupTables?: LUTTables;

	private backup() {
		// with how super.reset() works, storing a simple reference
		// to the old tables is sufficient as a backup
		this.lutBackupVariables = this.lutVariables;
		this.lutBackupScopes = this.lutScopes;
		this.lutBackupFunctions = this.lutFunctions;
		this.lutBackupTables = this.lutTables;
	}

	private restore() {
		// note: if undefined here, that means the doc was never parsed...
		this.lutVariables = this.lutBackupVariables!;
		this.lutScopes = this.lutBackupScopes!;
		this.lutFunctions = this.lutBackupFunctions!;
		this.lutTables = this.lutBackupTables!;
	}
//#endregion

//#region lookup LUTs
	private findVariable(position: Position) {
		const it = this.lutVariables[`:${position.line}:${position.character}`];
		if (it) return it;
	}

	private findScope(position: Position) {
		// the scope LUT is built in order of appearance:
		// parents scopes always come first; this aims at
		// finding the smallest scope containing the `position`,
		// hence the search backward
		for (let k = this.lutScopes.length-1; -1 < k; k--) {
			const it = this.lutScopes[k];
			if (rangeContains(it.range, position))
				return it;
		}
		// XXX: the pico8parse stops the main 'Chunk''s scope
		// on the last _meaningful_ character, which means
		// that following empty lines are not in any scope ;-;
		return this.lutScopes[0];
		// `range` undefined: ie. whole file (for TextDocument.getText)
	}

	private findFunction(position: Position) {
		const it = this.lutFunctions[`:${position.line}:${position.character-1}`];
		if (it) return it;
	}

	private findTable(position: Position) {
		const it = this.lutTables[`:${position.line}:${position.character}`];
		if (it) return it;
	}
//#endregion

}

export class DocumentsManager extends TextDocuments<TextDocument> {

	private cache: Map<string, Document>;
	private connection?: Connection;

	constructor(public settings: SettingsManager) {
		super(TextDocument);
		this.cache = new Map();
	}

	/**
	 * listening on a connection will overwrite the following handlers on a connection:
	 * 
	 * from `TextDocuments<>`:
	 * 
	 * `onDidOpenTextDocument`, `onDidChangeTextDocument`, `onDidCloseTextDocument`,
	 * `onWillSaveTextDocument`, `onWillSaveTextDocumentWaitUntil` and `onDidSaveTextDocument`
	 * 
	 * from `DocumentsManager`:
	 * 
	 * `onHover`, `onDocumentSymbol` , `onCompletion`, `onCompletionResolve`,
	 * `onDocumentHighlight` and `onSignatureHelp`
	 */
	listen(connection: Connection) {
		super.listen(connection);
		this.connection = connection;

		this.onDidChangeContent(this.handleOnDidChangeContent.bind(this));
		connection.onHover(this.handleOnHover.bind(this));
		connection.onDocumentSymbol(this.handleOnDocumentSymbol.bind(this));
		connection.onCompletion(this.handleOnCompletion.bind(this));
		connection.onCompletionResolve(this.handleOnCompletionResolve.bind(this));
		connection.onDocumentHighlight(this.handleOnDocumentHighlight.bind(this));
		connection.onSignatureHelp(this.handleOnSignatureHelp.bind(this));
	}

//#region handlers (dispatches to the appropriate Document's handler)
	private handleOnDidChangeContent(change: TextDocumentChangeEvent<TextDocument>) {
		const uri = change.document.uri;
		const document = this.cache.get(uri) ?? new Document(uri, this);
		const diagnostics = document.handleOnDidChangeContent(change.document) ?? [];

		this.cache.set(uri, document);
		this.connection?.sendDiagnostics({ diagnostics, uri });
	}

	private handleOnHover(hoverParams: HoverParams) {
		const position = hoverParams.position;
		const uri = hoverParams.textDocument.uri;

		// the one instance of the class above (has the AST)
		const document = this.cache.get(uri);
		if (!document) return null;

		// the one from the languageserver module (has the text)
		const textDocument = this.get(uri);
		if (!textDocument) return null;

		return document.handleOnHover(findWordRange(textDocument, position));
	}

	private handleOnDocumentSymbol(documentSymbolParams: DocumentSymbolParams) {
		const document = this.cache.get(documentSymbolParams.textDocument.uri);
		return document?.handleOnDocumentSymbol();
	}

	private handleOnCompletion(completionParams: CompletionParams) {
		const position = completionParams.position;
		const uri = completionParams.textDocument.uri;

		// the one instance of the class above (has the AST)
		const document = this.cache.get(uri);
		if (!document) return null;

		// the one from the languageserver module (has the text)
		const textDocument = this.get(uri);
		if (!textDocument) return null;

		const identifierRange = findWordRange(textDocument, { line: position.line, character: position.character-2 });
		const identifier = textDocument.getText(identifierRange);

		return document?.handleOnCompletion(position, identifier, completionParams.context);
	}

	private handleOnCompletionResolve(completionItem: CompletionItem) {
		if (!completionItem.data) return completionItem;
		const document = this.cache.get(completionItem.data.uri);
		return document?.handleOnCompletionResolve(completionItem) ?? completionItem;
	}

	private handleOnDocumentHighlight(documentHighlightParams: DocumentHighlightParams) {
		const position = documentHighlightParams.position;
		const uri = documentHighlightParams.textDocument.uri;

		// the one instance of the class above (has the AST)
		const document = this.cache.get(uri);
		if (!document) return null;

		// the one from the languageserver module (has the text)
		const textDocument = this.get(uri);
		if (!textDocument) return null;

		return document.handleOnDocumentHighlight(findWordRange(textDocument, position));
	}

	private handleOnSignatureHelp(signatureHelpParams: SignatureHelpParams) {
		const position = signatureHelpParams.position;
		const uri = signatureHelpParams.textDocument.uri;

		// the one instance of the class above (has the AST)
		const document = this.cache.get(uri);
		if (!document) return null;

		// the one from the languageserver module (has the text)
		const textDocument = this.get(uri);
		if (!textDocument) return null;

		const identifierRange = findWordRange(textDocument, { line: position.line, character: position.character-2 });
		const identifier = textDocument.getText(identifierRange);

		return document?.handleOnSignatureHelp(position, identifier, signatureHelpParams.context);
	}
//#endregion

}
