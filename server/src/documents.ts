import { parse, Options as ParseOptions, SyntaxError as ParseError } from 'pico8parse';
import { Connection, DocumentSymbolParams, Hover, HoverParams, TextDocuments, TextDocumentChangeEvent } from 'vscode-languageserver';
import { Position, Range, TextDocument } from 'vscode-languageserver-textdocument';

import { SelfExplore } from './document/explore';
import { represent } from './document/typing';
import { SettingsManager } from './settings';
import { findWordRange, rangeContains } from './util';

const parseOptions: Partial<ParseOptions> = {
	luaVersion: 'PICO-8-0.2.1', // XXX: from option or from p8 file header
	locations: true,
	comments: true,
};

export class Document extends SelfExplore {

	constructor(public uri: string, private manager: DocumentsManager) {
		super();
	}

	handleOnDidChangeContent(textDocument: TextDocument) {
		try {
			console.log("======= Parsing document =======");
			this.reset();
			this.ast = parse(textDocument.getText(), parseOptions);
			this.explore();
			console.log("------------- done -------------");
		} catch (err) {
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
					`(${found.scopeTag}) ${found.name}: ${represent(found.type)}`,
					...(!found.doc ? [] : [
						" ",
						"---",
						found.doc,
					]),
					...(!found.info ?  [] : [
						" ",
						"---",
						"```",
						...found.info,
						"```",
					]),
				].join("\r\n"),
			}
		};
	}

	handleOnDocumentSymbol() {
		return this.symbols;
	}

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
	}

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
	}

	private handleOnDidChangeContent(change: TextDocumentChangeEvent<TextDocument>) {
		const uri = change.document.uri;
		const document = this.cache.get(uri) ?? new Document(uri, this);
		const diagnostics = document.handleOnDidChangeContent(change.document);

		this.cache.set(uri, document);
		this.connection?.sendDiagnostics({ diagnostics, uri });
	}

	private handleOnHover(textDocumentPosition: HoverParams) {
		const position = textDocumentPosition.position;
		const uri = textDocumentPosition.textDocument.uri;
		console.log("Hovering: " + JSON.stringify(position));

		// the one instance of the class above (has the AST)
		const document = this.cache.get(uri);
		if (!document) return null;

		// the one from the languageserver module (has the text)
		const textDocument = this.get(uri);
		if (!textDocument) return null;

		return document.handleOnHover(findWordRange(textDocument, position));
	}

	private handleOnDocumentSymbol(textDocumentIdentifier: DocumentSymbolParams) {
		const document = this.cache.get(textDocumentIdentifier.textDocument.uri);
		return document?.handleOnDocumentSymbol();
	}

}
