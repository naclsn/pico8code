import { parse, Options as ParseOptions, SyntaxError as ParseError } from 'pico8parse';
import { Connection, DocumentSymbolParams, Hover, HoverParams, TextDocuments, TextDocumentChangeEvent, CompletionParams, CompletionItem as BaseCompletionItem, CompletionContext, DocumentSymbol, Diagnostic, CompletionItemKind } from 'vscode-languageserver';
import { Position, Range, TextDocument } from 'vscode-languageserver-textdocument';

import { LUTScopes, LUTVariables, SelfExplore } from './document/explore';
import { isLuaFunction, represent } from './document/typing';
import { SettingsManager } from './settings';
import { findWordRange, locToRange, rangeContains, representVariableHover } from './util';

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
				value: [
					representVariableHover(found.scopeTag, found.name, found.type, found.doc),
					/*-*/...(!found.info ?  [] : [
						" ",
						"---",
						"```",
						...found.info,
						"```",
					]),
				].join("\n"),
			},
		};
	}

	handleOnDocumentSymbol(): DocumentSymbol[] | null {
		return this.symbols;
	}

	handleOnCompletion(position: Position, context?: CompletionContext): CompletionItem[] | null {
		const found = this.findScope(position);
		if (!found) return null;

		const list: CompletionItem[] = [];
		for (const label in found.scope.variables) {
			const it = found.scope.variables[label]!;
			list.push({
				label,
				documentation: it.ranges
					.slice()
					.reverse()
					.map((_it, k) => `${represent(it.types[k])} (${_it.start.line}:${_it.start.character} in ${it.scopes[k].tag})`)
					.join(", "),
				data: {
					uri: this.uri,
					recent: it.ranges[0].start,
				},
			});
		}
		return list;
	}

	handleOnCompletionResolve(item: CompletionItem): CompletionItem | null {
		if (!item.data) return null;
		const found = this.findVariable(item.data.recent);
		if (!found) return null;

		const type = found.doc?.type ?? found.type;
		item.kind = isLuaFunction(type)
			? CompletionItemKind.Function
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
//#endregion

//#region backup LUTs for parse failures
	private lutBackupVariables?: LUTVariables;
	private lutBackupScopes?: LUTScopes;

	private backup() {
		// with how super.reset() works, storing a simple reference
		// to the old tables is sufficient as a backup
		this.lutBackupVariables = this.lutVariables;
		this.lutBackupScopes = this.lutScopes;
	}

	private restore() {
		// note: if undefined here, that means the doc was never parsed...
		if (this.lutBackupVariables) this.lutVariables = this.lutBackupVariables;
		if (this.lutBackupScopes) this.lutScopes = this.lutBackupScopes;
		// release the backup (?)
		this.lutBackupVariables = undefined;
		this.lutBackupScopes = undefined;
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
		return { scope: this.globalScope, range: undefined };
		// `range` undefined: ie. whole file (for TextDocument.getText)
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
	 * `onHover`, `onDocumentSymbol` [, `onCompletion` and `onCompletionResolve` (not yet)]
	 */
	listen(connection: Connection) {
		super.listen(connection);
		this.connection = connection;

		this.onDidChangeContent(this.handleOnDidChangeContent.bind(this));
		connection.onHover(this.handleOnHover.bind(this));
		connection.onDocumentSymbol(this.handleOnDocumentSymbol.bind(this));
		connection.onCompletion(this.handleOnCompletion.bind(this));
		connection.onCompletionResolve(this.handleOnCompletionResolve.bind(this));
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
		const document = this.cache.get(completionParams.textDocument.uri);
		return document?.handleOnCompletion(completionParams.position, completionParams.context);
	}

	private handleOnCompletionResolve(completionItem: CompletionItem) {
		if (!completionItem.data) return completionItem;
		const document = this.cache.get(completionItem.data.uri);
		return document?.handleOnCompletionResolve(completionItem) ?? completionItem;
	}
//#endregion

}
