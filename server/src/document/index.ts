import {  parse, Options as ParseOptions, SyntaxError as ParseError } from 'pico8parse';
import { Connection, Hover } from 'vscode-languageserver';
import { Position, Range, TextDocument } from 'vscode-languageserver-textdocument';
import { SelfExplore } from './explore';
import { represent } from './typing';

const parseOptions: Partial<ParseOptions> = {
	luaVersion: 'PICO-8-0.2.1',
	locations: true,
};

export class Pico8Document extends SelfExplore {

	constructor(public connection: Connection, public uri: string) {
		super();
	}

	onContentUpdate(textDocument: TextDocument) {
		try {
			console.log("Parsing document");
			this.clear();
			this.ast = parse(textDocument.getText(), parseOptions);
			this.updateSymbols();
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

	onHoverAt(range: Range, position: Position): Hover | null {
		const index = `:${range.start.line}:${range.start.character}`;
		const found = this.ranges[index];
		console.log("================" + index);
		console.log(found);
		if (!found) return null;
		return {
			contents: {
				kind: 'markdown',
				value: [
					found.name + ": " + represent(found.type),
					"```json", // prevents circular errors @thx https://stackoverflow.com/a/46908358/13196480
					JSON.stringify(found.info, (k, v) => k && v && typeof v !== "number" ? (Array.isArray(v) ? "[object Array]" : "" + v) : v, 2),
					"```",
				].join("\r\n"),
			}
		};
	}

	onRequestSymbols() {
		//console.log("Serving symbols");
		return this.symbols;
	}

	private updateSymbols() {
		//console.log("Updating symbols");
		//this.symbols = [];
		//explore[this.ast.type]?.(this.symbols, this.ast);

		//console.log("Building scope");
		this.explore();
		//console.dir(this.globalScope, { depth: 42 });

		//console.log("Found ranges");
		//console.dir(this.ranges, { depth: 42 });
	}
}
