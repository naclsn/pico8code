import { ast } from 'pico8parse';
import { Diagnostic, DiagnosticSeverity, DocumentSymbol, SymbolKind, SymbolTag } from 'vscode-languageserver';
import { Range } from 'vscode-languageserver-textdocument';

import { aug } from './augmented';
import { LuaType, resolve, LuaScope, LuaDoc, parse } from './typing';
import { locToRange } from '../util';

/** @thanks https://stackoverflow.com/a/64469734/13196480 */
type FindByTType<Union, TType> = Union extends { type: TType } ? Union : never;

type TTypes = ast.Node['type'];
type NodeHandlers = { [TType in TTypes]: (node: FindByTType<ast.Node, TType>) => void }

export type LUTVariables = { [startPos: string]: {
	range: Range,
	name: string,
	type: LuaType,
	doc?: LuaDoc,
	/*-*/scopeTag: string,
	/*-*/info?: string[],
} }

export type LUTScopes = {
	range: Range,
	scope: LuaScope,
}[]

export class SelfExplore {

	protected ast: ast.Chunk = { type: 'Chunk', body: [] };
	private handlers: NodeHandlers;

	protected reset() {
		this.ast = { type: 'Chunk', body: [] };

		this.docLineMap = {};

		this.diagnostics = [];

		this.symbols = [];
		this.currentSymbol = undefined;

		this.lutScopes = [];
		this.globalScope = { tag: "global", labels: {}, variables: {}, };
		this.currentScope = undefined!;

		this.lutVariables = {};

		this.contextStack = [];
	}

	protected explore() {
		if (this.ast) {
			this.gatherDoc();
			this.handlers.Chunk(this.ast);
		} else throw new Error("How did we get here?\n" + `explore, ast: ${this.ast}`);
	}

//#region doc
	private docLineMap: { [endLine: number]: {
		range: Range,
		raw: string,
		value: LuaDoc,
	} | undefined } = {};

	private docProcess(raw: string): LuaDoc {
		const lines = raw.split(/\r?\n/g);

		let type: LuaType | undefined;
		try {
			type = parse(lines[0]);
			lines.shift();
		} catch { type = undefined; }

		// XXX: more? (references to function params, table keys, links to other names...)
		const text = lines.map(it => it.trim()).join("\n").trim();

		return { type, text };
	}

	/**
	 * gather every long-string comments and map them by _ending_ line number
	 * 
	 * note: line is the `Position['line']`
	 * 
	 * XXX:
	 * because comments are just chucked in an array under the main 'Chunk',
	 * it is simpler to have a requirement that doc comment be attached to the
	 * associated object with no line in between and not on the same line
	 */
	private gatherDoc() { // XXX: the @types/pico8parse is not up-to-date
		(this.ast.comments as ast.Comment[] | undefined)?.forEach(it => {
			if (it.raw.startsWith("--[[") && it.raw.endsWith("]]")) {
				const range = locToRange(it.loc);
				this.docLineMap[range.end.line] = {
					range,
					raw: it.rawInterrupted ?? it.raw,
					value: this.docProcess(it.value),
				};
			}
		});
	}

	/**
	 * XXX:
	 * because comments are just chucked in an array under the main 'Chunk',
	 * it is simpler to have a requirement that doc comment be attached to the
	 * associated object with no line in between and not on the same line
	 */
	private matchingDoc(range: Range) {
		return this.docLineMap[range.start.line - 1]?.value;
	}
//#endregion

//#region diagnostics
	protected diagnostics: Diagnostic[] = [];

	hint(message: string, range: Range) {
		this.diagnostics.push({
			message,
			range,
			severity: DiagnosticSeverity.Hint,
		});
	}

	information(message: string, range: Range) {
		this.diagnostics.push({
			message,
			range,
			severity: DiagnosticSeverity.Information,
		});
	}

	warning(message: string, range: Range) {
		this.diagnostics.push({
			message,
			range,
			severity: DiagnosticSeverity.Warning,
		});
	}

	error(message: string, range: Range) {
		this.diagnostics.push({
			message,
			range,
			severity: DiagnosticSeverity.Error,
		});
	}
//#endregion

//#region symbols
	protected symbols: DocumentSymbol[] = [];
	private currentSymbol?: DocumentSymbol & { parent?: DocumentSymbol };

	private symbolEnter(name: string, kind: SymbolKind, range: Range, selectionRange: Range) {
		const newSymbol = { name, kind, range, selectionRange, parent: this.currentSymbol };
		if (this.currentSymbol) {
			if (!this.currentSymbol.children) this.currentSymbol.children = [newSymbol];
			else this.currentSymbol.children.push(newSymbol);
		} else this.symbols.push(newSymbol);
		this.currentSymbol = newSymbol;
	}

	private symbolExit(detail?: string, tags?: SymbolTag[]) {
		if (this.currentSymbol) {
			this.currentSymbol.detail = detail;
			this.currentSymbol.tags = tags;
		} else throw new Error("How did we get here?\n" + `symbolExit, detail: ${detail}, tags: ${tags}`);
		this.currentSymbol = this.currentSymbol.parent;
	}
//#endregion

//#region scopes
	protected lutScopes: LUTScopes = [];

	private globalScope: LuaScope = { tag: "global", labels: {}, variables: {}, };
	private currentScope!: LuaScope;

	/**
	 * forks a new scope from the current one, sets it as current
	 * and return the previous scope for use with `restore`
	 * 
	 * @param range the range of the new scope
	 * @param tag a tag to set on the new scope
	 */
	private scopeFork(range: Range, tag: string): LuaScope {
		const previousScope = this.currentScope;
		this.currentScope = {
			labels: Object.create(this.currentScope.labels),
			variables: Object.create(this.currentScope.variables),
			tag,
		};
		this.lutScopes.push({ range, scope: this.currentScope });
		return previousScope;
	}

	/**
	 * restore a previous scope to current, to use with `fork`
	 */
	private scopeRestore(previousScope: LuaScope) {
		this.currentScope = previousScope;
	}
//#endregion

//#region variables
	/**
	 * only declare: should not already be visible!
	 * 
	 * if the `name` is not local to the `scope`, it will shadow
	 * the any same `name` from parent scopes
	 * 
	 * @param scope scope to affect, defaults to current
	 */
	private variableDeclare(name: string, range: Range, value: aug.Expression, scope?: LuaScope) {
		const theScope = scope ?? this.currentScope;
		if (!Object.prototype.hasOwnProperty.call(theScope.variables, name)) {
			theScope.variables[name] = {
				values: [value],
				ranges: [range],
				scopes: [theScope],
			};
		} else throw new Error("How did we get here?\n" + `declare, name: ${name}, value: ${value.type}`);
		// XXX: it was declared twice, that's how (eg. from two 'local's or a 'local' and a function param...)
	}

	/**
	 * only update, should already be declared!
	 * 
	 * @param scope scope to affect, defaults to current
	 */
	private variableUpdate(name: string, range: Range, value: aug.Expression, scope?: LuaScope) {
		const variable = this.currentScope.variables[name];
		if (variable) {
			variable.values.unshift(value);
			variable.ranges.unshift(range);
			variable.scopes.unshift(scope ?? this.currentScope);
		} else throw new Error("How did we get here?\n" + `update, name: ${name}, value: ${value.type}`);
	}

	/**
	 * lookup a visible `name` from the current scope (and its parents)
	 */
	private variableLookup(name: string) {
		return this.currentScope.variables[name];
	}
	protected lutVariables: LUTVariables = {};

	private variableLocate(name: string, range: Range) {
		const variable = this.variableLookup(name);
		const doc = this.matchingDoc(range);
		this.lutVariables[`:${range.start.line}:${range.start.character}`] = {
			range,
			name,
			type: variable ? resolve(variable.values[0]) : 'nil', // XXX: for now '0' ie. 'latest'
			doc,
			scopeTag: variable?.scopes[0].tag ?? this.currentScope.tag,
			info: variable?.values.map((it, k) => `(${variable.scopes[k].tag}) ${it.type}`),
		};
		return range;
	}
//#endregion

//#region context
	private contextStack: aug.Node[] = [];

	private contextPush(node: ast.Node) {
		this.contextStack.unshift(node as aug.Node);
	}

	private contextFind<TType extends TTypes>(type: TType) {
		return this.contextStack.find(it => type === it.type) as FindByTType<aug.Node, TType> | undefined;
	}

	private contextPeek() {
		return this.contextStack[0];
	}

	private contextPop(expectedType: TTypes) {
		const got = this.contextStack.shift();
		if (expectedType !== got?.type)
			throw Error(`Expecting state to have a ${expectedType}, found ${got?.type}`);
	}
//#endregion

//#region handlers
	constructor() {
		this.handlers = {
			Chunk: node => {
				this.contextPush(node);
					// create and push global scope
					this.currentScope = this.globalScope;
					this.lutScopes.push({ range: locToRange(node.loc), scope: this.currentScope });

					node.body.forEach(it => this.handlers[it.type](it as any));
				this.contextPop('Chunk');
			},

			Comment: (node) => { void 0; },

			Identifier: (node) => {
				const augmented = node as aug.Identifier;
				if (!augmented.augValue)
					augmented.augValue = this.variableLookup(augmented.name)?.values[0];

				this.variableLocate(node.name, locToRange(node.loc));
			},

			FunctionDeclaration: (node) => {
				const range = locToRange(node.loc);

				// XXX: selectionRange and such will need the identifier part to be processed before (or at least some of it)
				this.symbolEnter('Identifier' === node.identifier?.type ? node.identifier.name : "<anonymous>", SymbolKind.Function, range, range);
					this.contextPush(node);
						const previousScope = this.scopeFork(range, "function line " + node.loc?.start.line);
							node.parameters.forEach(it => {
								(it as aug.Identifier).augValue = { type: 'NilLiteral', value: null, raw: '' };
								this.handlers[it.type](it as any);
							});
							node.body.forEach(it => this.handlers[it.type](it as any));
						this.scopeRestore(previousScope);
					this.contextPop('FunctionDeclaration');
				this.symbolExit();

				(node as aug.FunctionDeclaration).augValue = node;
				if (node.identifier) {
					if ('Identifier' === node.identifier.type) {
						const augmented = node.identifier as aug.Identifier;
						augmented.augValue = node as aug.FunctionDeclaration;

						// TODO: if already exist
						if (node.isLocal) this.variableDeclare(augmented.name, locToRange(augmented.loc), augmented.augValue);
						else this.variableDeclare(augmented.name, locToRange(augmented.loc), augmented.augValue, this.globalScope);
					}
					this.handlers[node.identifier.type](node.identifier as any);
				}
			},

		//#region statements
			LabelStatement: ({ label, loc }) => {
				const range = locToRange(loc);
				if (Object.prototype.hasOwnProperty.call(this.currentScope.labels, label.name)) {
					const previous = this.currentScope.labels[label.name];
					this.warning("label already defined line " + previous?.start.line, range);
				} else {
					this.currentScope.labels[label.name] = range;
				}
			},

			BreakStatement: (node) => { void 1; },

			GotoStatement: ({ label, loc }) => {
				if (!Object.prototype.hasOwnProperty.call(this.currentScope.labels, label.name))
					this.warning("label not defined", locToRange(loc));
				else {
					const range = locToRange(label.loc);
					const line = this.currentScope.labels[label.name]?.start.line ?? 0;
					this.lutVariables[`:${range.start.line}:${range.start.character}`] = {
						range,
						name: label.name,
						type: "line " + (line+1) as LuaType, // XXX: what it that?!
						scopeTag: this.currentScope.tag,
					};
				}
			},

			ReturnStatement: (node) => {
				const fun = this.contextFind('FunctionDeclaration');
				if (!fun) {
					this.error("no function to return from", locToRange(node.loc));
					return;
				}
				if (!fun.augReturns) fun.augReturns = [];
				node.arguments.forEach(it => this.handlers[it.type](it as any));
				fun.augReturns.push(node);
			},

			IfStatement: (node) => {
				this.contextPush(node);
					node.clauses.forEach(it => this.handlers[it.type](it as any));
				this.contextPop('IfStatement');
			},

			WhileStatement: (node) => {
				this.contextPush(node);
					this.handlers[node.condition.type](node.condition as any);

					const previousScope = this.scopeFork(locToRange(node.loc), "while line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.scopeRestore(previousScope);
				this.contextPop('WhileStatement');
			},

			DoStatement: (node) => {
				this.contextPush(node);
					const previousScope = this.scopeFork(locToRange(node.loc), "do line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.scopeRestore(previousScope);
				this.contextPop('DoStatement');
			},

			RepeatStatement: (node) => {
				this.contextPush(node);
					const previousScope = this.scopeFork(locToRange(node.loc), "repeat line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.scopeRestore(previousScope);

					this.handlers[node.condition.type](node.condition as any);
				this.contextPop('RepeatStatement');
			},

			LocalStatement: (node) => {
				const types = node.init.flatMap(it => {
					this.handlers[it.type](it as any);
					const augmented = it as aug.Expression;
					switch (augmented.type) {
						case 'CallExpression':
						case 'TableCallExpression':
						case 'StringCallExpression':
							return augmented.augValues ?? [];
						case 'Identifier':
						case 'NilLiteral':
						case 'NumericLiteral':
						case 'BooleanLiteral':
						case 'StringLiteral':
						case 'VarargLiteral':
						case 'FunctionDeclaration':
						case 'BinaryExpression':
						case 'LogicalExpression':
						case 'UnaryExpression':
							return augmented.augValue ?? [];
					}
				});
				node.variables.forEach((it, k) => {
					const augmented = it as aug.Identifier;
					augmented.augValue = types[k];

					// TODO: if already exist
					this.variableDeclare(augmented.name, locToRange(augmented.loc), augmented.augValue ?? { type: 'NilLiteral', value: null, raw: '' });
					this.handlers.Identifier(augmented);
				});
			},

			AssignmentStatement: (node) => {
				const types = node.init.flatMap(it => {
					this.handlers[it.type](it as any);
					const augmented = it as aug.Expression;
					switch (augmented.type) {
						case 'CallExpression':
						case 'TableCallExpression':
						case 'StringCallExpression':
							return augmented.augValues ?? [];
						case 'Identifier':
						case 'NilLiteral':
						case 'NumericLiteral':
						case 'BooleanLiteral':
						case 'StringLiteral':
						case 'VarargLiteral':
						case 'FunctionDeclaration':
						case 'BinaryExpression':
						case 'LogicalExpression':
						case 'UnaryExpression':
							return augmented.augValue ?? [];
					}
				});
				node.variables.forEach((it, k) => {
					const augmented = it as aug.Identifier;
					augmented.augValue = types[k];

					// if 'name' is visible from current scope
					const variable = this.variableLookup(augmented.name);
					if (variable) {
						// update locally
						this.variableUpdate(augmented.name, locToRange(augmented.loc), augmented.augValue ?? { type: 'NilLiteral', value: null, raw: '' }, variable.scopes[0]);
						this.handlers.Identifier(augmented);
					} else {
						// declare globally
						this.variableDeclare(augmented.name, locToRange(augmented.loc), augmented.augValue ?? { type: 'NilLiteral', value: null, raw: '' }, this.globalScope);
						this.handlers.Identifier(augmented);
					}
				});
			},

			AssignmentOperatorStatement: (node) => {
				/*-
					this should be handled knowing that:
						- doesn't deal well with more than one init
						- .. same with more than one variable
						- never apply to other than 'number' type
						- .. except for when more than one variable
				 */
				// every variables should exists, so this is handled like a LocalStatement
				/*const types = node.init.flatMap(it => {
					this.handlers[it.type](it as any);
					const augmented = it as aug.Expression;
					switch (augmented.type) {
						case 'CallExpression':
						case 'TableCallExpression':
						case 'StringCallExpression':
							return augmented.augValues ?? [];
						case 'Identifier':
						case 'NilLiteral':
						case 'NumericLiteral':
						case 'BooleanLiteral':
						case 'StringLiteral':
						case 'VarargLiteral':
						case 'FunctionDeclaration':
						case 'BinaryExpression':
						case 'LogicalExpression':
						case 'UnaryExpression':
							return augmented.augValue ?? [];
					}
				});
				node.variables.forEach((it, k) => {
					const augmented = it as aug.Identifier;
					augmented.augValue = types[k];

					// 'name' should be visible from current scope
					const variable = this.lookup(augmented.name);
					if (variable) {
						// handle locally
						this.update(augmented.name, augmented.augValue ?? { type: 'NilLiteral', value: null, raw: '' }, variable.scopes[0]); // XXX: pushing undefined!
						this.handlers.Identifier(augmented);
					} else {
						// handle globally
						this.declare(augmented.name, augmented.augValue ?? { type: 'NilLiteral', value: null, raw: '' }, this.globalScope); // XXX: pushing undefined!
						this.handlers.Identifier(augmented);
					}
				});*/
			},

			CallStatement: (node) => {
				this.contextPush(node);
					this.handlers[node.expression.type](node.expression as any);
				this.contextPop('CallStatement');
			},

			ForNumericStatement: (node) => {
				this.contextPush(node);
					const previousScope = this.scopeFork(locToRange(node.loc), "for line " + node.loc?.start.line);
						this.handlers.Identifier(node.variable);
						[node.start, node.end, node.step].map(it => it && this.handlers[it.type](it as any));

						node.body.forEach(it => this.handlers[it.type](it as any));
					this.scopeRestore(previousScope);
				this.contextPop('WhileStatement');
			},

			ForGenericStatement: (node) => {
				this.contextPush(node);
					const previousScope = this.scopeFork(locToRange(node.loc), "for line " + node.loc?.start.line);
						node.variables.map(it => this.handlers[it.type](it as any));
						node.iterators.map(it => this.handlers[it.type](it as any)); // XXX

						node.body.forEach(it => this.handlers[it.type](it as any));
					this.scopeRestore(previousScope);
				this.contextPop('WhileStatement');
			},
		//#endregion

		//#region clauses
			IfClause: (node) => {
				this.contextPush(node);
					this.handlers[node.condition.type](node.condition as any);

					const previousScope = this.scopeFork(locToRange(node.loc), "if line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.scopeRestore(previousScope);
				this.contextPop('IfClause');
			},

			ElseifClause: (node) => {
				this.contextPush(node);
					this.handlers[node.condition.type](node.condition as any);

					const previousScope = this.scopeFork(locToRange(node.loc), "elseif line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.scopeRestore(previousScope);
				this.contextPop('ElseifClause');
			},

			ElseClause: (node) => {
				this.contextPush(node);
					const previousScope = this.scopeFork(locToRange(node.loc), "else line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.scopeRestore(previousScope);
				this.contextPop('ElseClause');
			},
		//#endregion

		//#region table
			TableKey: (node) => { void 1; },

			TableKeyString: (node) => { void 1; },

			TableValue: (node) => { void 1; },
		//#endregion

		//#region expressions
			TableConstructorExpression: (node) => { void 1; },

			BinaryExpression: (node) => {
				[node.left, node.right].map(it => this.handlers[it.type](it as any));
				(node as aug.BinaryExpression).augValue = node;
			},

			LogicalExpression: (node) => {
				[node.left, node.right].map(it => this.handlers[it.type](it as any));
				(node as aug.LogicalExpression).augValue = node;
			},

			UnaryExpression: (node) => {
				this.handlers[node.argument.type](node.argument as any);
				(node as aug.UnaryExpression).augValue = node;
			},

			MemberExpression: (node) => { void 1; }, // TODO

			IndexExpression: (node) => { void 1; }, // TODO

			CallExpression: (node) => {
				this.contextPush(node);
					const augmented = node.base as aug.Identifier;
					this.handlers.Identifier(augmented);
					(node as aug.CallExpression).augValues = [augmented.augValue!];

					node.arguments.forEach(it => this.handlers[it.type](it as any));
				this.contextPop('CallExpression');
			},

			TableCallExpression: (node) => {
				this.contextPush(node);
					const augmented = node.base as aug.Identifier;
					this.handlers.Identifier(augmented);
					(node as aug.TableCallExpression).augValues = [augmented.augValue!];

					this.handlers[node.argument.type](node.argument as any);
				this.contextPop('TableCallExpression');
			},

			StringCallExpression: (node) => {
				this.contextPush(node);
					const augmented = node.base as aug.Identifier;
					this.handlers.Identifier(augmented);
					(node as aug.StringCallExpression).augValues = [augmented.augValue!];

					this.handlers[node.argument.type](node.argument as any);
				this.contextPop('StringCallExpression');
			},
		//#endregion

		//#region literals
			StringLiteral: (node) => {
				(node as aug.StringLiteral).augValue = node;
			},

			NumericLiteral: (node) => {
				(node as aug.NumericLiteral).augValue = node;
			},

			BooleanLiteral: (node) => {
				(node as aug.BooleanLiteral).augValue = node;
			},

			NilLiteral: (node) => {
				(node as aug.NilLiteral).augValue = node;
			},

			VarargLiteral: (node) => {
				(node as aug.VarargLiteral).augValue = node;
			},
		//#endregion
		};
	}
//#endregion

}
