import { readdir, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { parse as parseLua, Options as ParseOptions, SyntaxError as ParseError, LuaVersion } from 'pico8parse';
import { Connection, DocumentSymbolParams, Hover, HoverParams, TextDocuments, TextDocumentChangeEvent, CompletionParams, CompletionItem as BaseCompletionItem, CompletionContext, DocumentSymbol, Diagnostic, CompletionItemKind, DocumentHighlightParams, DocumentHighlight, SignatureHelpParams, SignatureHelp, CompletionTriggerKind, SignatureHelpContext, DocumentLinkParams, DocumentLink, DiagnosticSeverity } from 'vscode-languageserver';
import { Position, Range, TextDocument } from 'vscode-languageserver-textdocument';

import { LUTFunctions, LUTScopes, LUTTables, LUTVariables, SelfExplore } from './document/explore';
import { isLuaFunction, isLuaTable, LuaDoc, LuaFunction, LuaTable, LuaType, parse as parseType, represent } from './document/typing';
import { SettingsManager } from './settings';
import { findWordRange, locToRange, nearestParserVersion, providedVersion, rangeContains, representVariableHover, uriToFsPath } from './util';

const baseParseOptions: Partial<ParseOptions> = {
	locations: true,
	comments: true,
	ignoreP8scii: true,
	encodingMode: 'none',
} as any;

interface CompletionItem extends BaseCompletionItem {
	data?: {
		uri: string,
		recent: Position,
	};
}

export class Document extends SelfExplore {

	private includes: { directive: string, line: number, target: string, tooltip: string, range: Range }[] = [];
	private parseOptions: Partial<ParseOptions>;

	constructor(public uri: string, private manager: DocumentsManager) {
		super();
		this.parseOptions = { ...baseParseOptions };
	}

	defines() {
		return new Promise<void>((resolve, reject) => {
			this.manager.settings.getDocumentSettings(this.uri).then(settings => {
				const additional = settings?.parse?.preDefinedGlobals?.flatMap(it => {
					const co = it.indexOf(":");
					if (-1 < co) {
						const name = it.substring(0, co).trim();
						const doc = "From pre-defined globals";
						try {
							const type = parseType(it.substring(co + 1));
							return [{ name, type, doc }];
						} catch {
							return name ? [{ name, type: 'any' as LuaType, doc }] : [];
						}
					}
					return [];
				}) ?? [];
				if (additional.length) {
					console.log("Found additional user pre-defined:");
					console.dir(additional);
				}
				const base = join(__dirname, "..", "..", "api", "out");
				readdir(base, (err, dirs) => {
					if (err) reject(err);
					const api = dirs
						.flatMap(dir => readdirSync(join(base, dir))
							.map(it => JSON
								.parse(readFileSync(join(base, dir, it)).toString())
							)
						);
					api.push({ name: "?", type: 'any', doc: "" });
					const defs: { name: string, type: LuaType, doc: string }[] = api.concat(additional);
					defs.forEach(it => {
						this.globalScope.variables[it.name] = {
							ranges: [locToRange(undefined)],
							scopes: [this.globalScope],
							types: [it.type],
							doc: {
								text: it.doc,
								type: it.type,
							},
						};
					});
					resolve();
				});
			});
		});
	}

//#region handlers
	async handleOnDidChangeContent(textDocument: TextDocument): Promise<Diagnostic[] | null> {
		const docSettings = await this.manager.settings.getDocumentSettings(this.uri);
		const level = docSettings?.parse.dontBother;

		const includesDiagnostics: Diagnostic[] = [];
		const baseUri = this.uri.slice(0, this.uri.lastIndexOf('/'));

		this.includes = [];
		let line = -1;
		const cleanedText = (textDocument.getText() + "\n") // XXX: includes outside __lua__ section will...
			.replace(/^[ \t]*#include\s+(.*?)\s*\n|\n/gm, (directive, filename: string | undefined) => {
				line++;
				if (!filename) return directive;

				const target = baseUri + '/' + filename;
				const index = directive.lastIndexOf(filename);
				const range = {
					start: { line, character: index, },
					end: { line, character: index + filename.length },
				};

				// XXX: could not make the onDocumentLinkResolve work, but this should have been over there...
				// (also moved everything here to have diagnostics)
				let tooltip: string;
				const path = resolve(uriToFsPath(target));
				try {
					const content = readFileSync(path).toString();
					const p = content.indexOf('p');
					const n = content.indexOf('\n');
					const h = "pico-8 cartridge";
					const hasValidHeader = p < n && content.slice(p, p + h.length) !== h;

					tooltip = hasValidHeader
						? "PICO-8 include (includes `__lua__` sections)"
						: "raw include (includes the whole file)";

					if (65536 < content.length)
						includesDiagnostics.push({
							message: "file may be too long to be correctly included by PICO-8",
							range,
							severity: DiagnosticSeverity.Warning,
						});
				} catch {
					tooltip = "could not read file";

					if (filename.match(/".*"/)) tooltip+= " (try removing the \" \")";
					else if (filename.match(/'.*'/)) tooltip+= " (try removing the ' ')";
					else if (filename.match(/<.*>/)) tooltip+= " (try removing the < >)";
					else tooltip+= ` (make sure '${path}' is accessible)`;

					includesDiagnostics.push({
						message: tooltip,
						range,
						severity: DiagnosticSeverity.Error,
					});
				}

				this.includes.push({ directive, line, target, tooltip, range });
				return directive.replace("#i", "--");
			});

		if ('only coloration' === level) return null;

		const headerProvidedVersion = providedVersion(cleanedText.slice(0, cleanedText.indexOf("__lua__")));
		this.parseOptions.luaVersion = ("PICO-8-" + (!headerProvidedVersion
			? docSettings?.parse.defaultApiVersion
			: nearestParserVersion(headerProvidedVersion)
		)) as LuaVersion;

		includesDiagnostics.push({
			message: `assuming version '${this.parseOptions.luaVersion}' ${!headerProvidedVersion ? "(none found in header)" : "from header"}`,
			range: {start:{line:0,character:0},end:{line:0,character:16}},
			severity: DiagnosticSeverity.Hint,
		});

		{
			const p = cleanedText.indexOf('p');
			const n = cleanedText.indexOf('\n');
			const h = "pico-8 cartridge";
			this.parseOptions.ignoreStrictP8FileFormat = n < p || cleanedText.slice(p, p + h.length) !== h;
		}

		{
			const i = docSettings?.parse.ignoreP8scii;
			if ('boolean' === typeof i)
				(this.parseOptions as any).ignoreP8scii = i;
		}

		try {
			this.backup();
			console.log("======= Parsing document =======");
			this.reset();
			this.ast = parseLua(cleanedText, this.parseOptions);
			await this.defines();
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
			console.log("------------- gone -------------");
		}

		if ('no diagnostics' === level) return null;
		return [...includesDiagnostics, ...this.diagnostics];
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

				let k = 0;
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
					k++;
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

	handleOnDocumentLinks(): DocumentLink[] {
		return this.includes;
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

		const wrap = <T extends (...args: any[]) => any>(handler: T) => {
			const wrapped = handler.bind(this);
			/*return function(...args: any[]) {
				console.log("handler called: '" + handler.name + "'");
				return wrapped(...args);
			};*/
			return wrapped;
		};

		this.onDidChangeContent(wrap(this.handleOnDidChangeContent));
		connection.onHover(wrap(this.handleOnHover));
		connection.onDocumentSymbol(wrap(this.handleOnDocumentSymbol));
		connection.onCompletion(wrap(this.handleOnCompletion));
		connection.onCompletionResolve(wrap(this.handleOnCompletionResolve));
		connection.onDocumentHighlight(wrap(this.handleOnDocumentHighlight));
		connection.onSignatureHelp(wrap(this.handleOnSignatureHelp));
		connection.onDocumentLinks(wrap(this.handleOnDocumentLinks));
	}

//#region handlers (dispatches to the appropriate Document's handler)
	private async handleOnDidChangeContent(change: TextDocumentChangeEvent<TextDocument>) {
		const uri = change.document.uri;
		const document = this.cache.get(uri) ?? new Document(uri, this);
		const diagnostics = await document.handleOnDidChangeContent(change.document) ?? [];

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

	private handleOnDocumentLinks(documentLinkParams: DocumentLinkParams): DocumentLink[] | null | undefined {
		const document = this.cache.get(documentLinkParams.textDocument.uri);
		return document?.handleOnDocumentLinks();
	}
//#endregion

}
