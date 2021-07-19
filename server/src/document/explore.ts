import { ast } from 'pico8parse';
import { Diagnostic, DiagnosticSeverity, DocumentSymbol } from 'vscode-languageserver';
import { Range } from 'vscode-languageserver-textdocument';

import { aug } from './augmented';
import { LuaType, resolve, LuaScope } from './typing';
import { locToRange } from '../util';

/** @thanks https://stackoverflow.com/a/64469734/13196480 */
type FindByTType<Union, TType> = Union extends { type: TType } ? Union : never;

type TTypes = ast.Node['type'];
type NodeHandler = { [TType in TTypes]: (node: FindByTType<ast.Node, TType>) => void }

export class SelfExplore {
	protected ast: ast.Chunk = { type: 'Chunk', body: [] };
	protected symbols: DocumentSymbol[] = [];

	protected reset() {
		this.ast = { type: 'Chunk', body: [] };

		this.diagnostics = [];
		this.symbols = [];

		this.lutVariables = {};
		this.lutScopes = [];

		this.globalScope = { tag: "global", labels: {}, variables: {}, };
		this.contextStack = [];
	}

	private handlers: NodeHandler;

	protected explore() {
		this.handlers.Chunk(this.ast);
	}

	protected lutVariables: { [name: string]: {
		range: Range,
		name: string,
		type: LuaType,
		/*-*/scopeTag: string,
		/*-*/info: any,
	} } = {};
	protected lutScopes: {
		range: Range,
		scope: LuaScope,
	}[] = [];

	private locate(name: string, range: Range) {
		const variable = this.lookup(name);
		this.lutVariables[`:${range.start.line}:${range.start.character}`] = {
			range,
			name,
			type: variable ? resolve(variable.values[0]) : 'nil', // XXX: for now '0' ie. 'latest'
			scopeTag: variable?.scopes[0].tag ?? this.currentScope.tag,
			info: variable?.values.map((it, k) => `(${variable.scopes[k].tag}) ${it.type}`),
		};
		return range;
	}

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

//#region scopes
	protected globalScope: LuaScope = { tag: "global", labels: {}, variables: {}, };
	protected currentScope!: LuaScope;

	/**
	 * forks a new scope from the current one, sets it as current
	 * and return the previous scope for use with `restore`
	 * 
	 * @param range the range of the new scope
	 * @param tag a tag to set on the new scope
	 */
	private fork(range: Range, tag: string): LuaScope {
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
	private restore(previousScope: LuaScope) {
		this.currentScope = previousScope;
	}

	/**
	 * only declare: should not already be visible!
	 * 
	 * if the `name` is not local to the `scope`, it will shadow
	 * the any same `name` from parent scopes
	 * 
	 * @param scope scope to affect, defaults to current
	 */
	private declare(name: string, value: aug.Expression, scope?: LuaScope) {
		const theScope = scope ?? this.currentScope;
		if (!Object.prototype.hasOwnProperty.call(theScope.variables, name)) {
			theScope.variables[name] = {
				values: [value],
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
	private update(name: string, value: aug.Expression, scope?: LuaScope) {
		const variable = this.currentScope.variables[name];
		if (variable) {
			variable.values.unshift(value);
			variable.scopes.unshift(scope ?? this.currentScope);
		} else throw new Error("How did we get here?\n" + `update, name: ${name}, value: ${value.type}`);
	}

	/**
	 * lookup a visible `name` from the current scope (and its parents)
	 */
	private lookup(name: string) {
		return this.currentScope.variables[name];
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
					augmented.augValue = this.lookup(augmented.name)?.values[0];

				this.locate(node.name, locToRange(node.loc));
			},

			FunctionDeclaration: (node) => {
				this.contextPush(node);
					const previousScope = this.fork(locToRange(node.loc), "function line " + node.loc?.start.line);
						node.parameters.forEach(it => {
							(it as aug.Identifier).augValue = null as any; // XXX
							this.handlers[it.type](it as any);
						});
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);
				this.contextPop('FunctionDeclaration');

				if (node.identifier) {
					if (node.identifier.type === 'Identifier') {
						const augmented = node.identifier as aug.Identifier;
						augmented.augValue = node as aug.FunctionDeclaration;

						// TODO: if already exist
						if (node.isLocal) this.declare(augmented.name, augmented.augValue);
						else this.declare(augmented.name, augmented.augValue, this.globalScope);
					}
					this.handlers[node.identifier.type](node.identifier as any);
				} else {
					(node as aug.FunctionDeclaration).augValue = node;
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
						type: "line " + (line+1) as any,
						scopeTag: this.currentScope.tag,
						info: null
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

					const previousScope = this.fork(locToRange(node.loc), "while line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);
				this.contextPop('WhileStatement');
			},

			DoStatement: (node) => {
				this.contextPush(node);
					const previousScope = this.fork(locToRange(node.loc), "do line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);
				this.contextPop('DoStatement');
			},

			RepeatStatement: (node) => {
				this.contextPush(node);
					const previousScope = this.fork(locToRange(node.loc), "repeat line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);

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
					this.declare(augmented.name, augmented.augValue ?? { type: 'NilLiteral', value: null, raw: '' });
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
					const variable = this.lookup(augmented.name);
					if (variable) {
						// update locally
						this.update(augmented.name, augmented.augValue ?? { type: 'NilLiteral', value: null, raw: '' }, variable.scopes[0]);
						this.handlers.Identifier(augmented);
					} else {
						// declare globally
						this.declare(augmented.name, augmented.augValue ?? { type: 'NilLiteral', value: null, raw: '' }, this.globalScope);
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
					const previousScope = this.fork(locToRange(node.loc), "for line " + node.loc?.start.line);
						this.handlers.Identifier(node.variable);
						[node.start, node.end, node.step].map(it => it && this.handlers[it.type](it as any));

						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);
				this.contextPop('WhileStatement');
			},

			ForGenericStatement: (node) => {
				this.contextPush(node);
					const previousScope = this.fork(locToRange(node.loc), "for line " + node.loc?.start.line);
						node.variables.map(it => this.handlers[it.type](it as any));
						node.iterators.map(it => this.handlers[it.type](it as any)); // XXX

						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);
				this.contextPop('WhileStatement');
			},
		//#endregion

		//#region clauses
			IfClause: (node) => {
				this.contextPush(node);
					this.handlers[node.condition.type](node.condition as any);

					const previousScope = this.fork(locToRange(node.loc), "if line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);
				this.contextPop('IfClause');
			},

			ElseifClause: (node) => {
				this.contextPush(node);
					this.handlers[node.condition.type](node.condition as any);

					const previousScope = this.fork(locToRange(node.loc), "elseif line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);
				this.contextPop('ElseifClause');
			},

			ElseClause: (node) => {
				this.contextPush(node);
					const previousScope = this.fork(locToRange(node.loc), "else line " + node.loc?.start.line);
						node.body.forEach(it => this.handlers[it.type](it as any));
					this.restore(previousScope);
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
