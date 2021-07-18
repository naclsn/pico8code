import { aug } from './augmented';

export type LuaNil = 'nil'
export type LuaNumber = 'number'
export type LuaBoolean = 'boolean'
export type LuaString = 'string'

export type LuaTable = {
	entries: { [key: string]: LuaType }
}

export type LuaFunction = {
	parameters: ({ name: string, type: LuaType })[],
	return: LuaType,
}

export type LuaType
	= LuaNil
	| LuaNumber
	| LuaBoolean
	| LuaString
	| LuaTable
	| LuaFunction
	| LuaType[]
	| { or: [LuaType, LuaType] }
	//| { and: [LuaType, LuaType] }
	//| { not: LuaType }

export function isLuaTable(type: LuaType): type is LuaTable {
	return !!(type as LuaTable).entries;
}
export function isLuaFunction(type: LuaType): type is LuaFunction {
	return !!(type as LuaFunction).return;
}

export function represent(type: LuaType): string {
	if ('string' === typeof type) return type;

	if (Array.isArray(type)) {
		const list = type
			.map(represent)
			.join(", ");
		return `[${list}]`;
	}

	if (isLuaFunction(type)) {
		const param = type.parameters
			.map(it => `${it.name}: ${it.type}`)
			.join(", ");
		const ret = represent(type.return);
		return `(${param}) -> ${ret}`;
	}

	if (isLuaTable(type)) {
		const entries = Object
			.entries(type.entries)
			.map(it => `${it[0]}: ${represent(it[1])}`)
			.join(", ");
		return `{ ${entries} }`;
	}

	// somewhat quite wrong if any "&" is added
	const [a, b] = type.or;
	return represent(a) + " | " + represent(b);
}

export function parse(repr: string): LuaType {
	/**
	 * find the first substring of `str` that is enclosed
	 * by the delimiters `open` and `close` (eg. "[" and "]")
	 * 
	 * `open` and `close` must be different and 1 character
	 * in length
	 * 
	 * the returned substring excludes the delimiters
	 * (undefined if none where found)
	 * 
	 * fails if `close` is present before `open` in `str`
	 * (ie. aborts and returns undefined)
	 * 
	 * @returns `[start, end]`
	 * 
	 * @example delimitSubstring("(a, b, c) -> [(d) -> nil]", "(", ")") === [1, 8]
	 */
	function delimitSubstring(str: string, open: string, close: string) {
		let s = 0;
		let n = 0;
		for (let k = 0; k < str.length; k++) {
			const c = str[k];
			if (c === open) {
				if (0 === n) s = k+1;
				n++;
			} else if (c === close) {
				n--;
				if (0 === n) return [s, k] as [start: number, end: number];
				if (n < 0) break;
			}
		}
		throw new SyntaxError(n < 0
			? `No matching ${open} for closing ${close}`
			: `No matching ${close} for opening ${open}`
		);
	}

	/**
	 * split `str` on `sep` in a list of substring while respecting
	 * pairs of delimiters (eg. doesn't split on "," within "[]")
	 * 
	 * `sep` must be 1 character in length
	 * 
	 * the respected delimiters are the following pairs:
	 * "()", "[]", "{}"
	 * 
	 * the returned substrings are trimmed
	 * 
	 * fails if `delimitSubstring` fails, returns undefined
	 * 
	 * @example splitCarefully("{ a: string, b: boolean }, number") === ["{ a: string, b: boolean }", " c: number"]
	 */
	function splitCarefully(str: string, sep: string) {
		const r: string[] = [];
		let l = 0;
		const pairs = "()[]{}";
		for (let k = 0; k < str.length; k++) {
			const c = str[k];
			const f = pairs.indexOf(c);
			if (-1 < f) {
				k+= delimitSubstring(str.substr(k), pairs[f], pairs[f+1])[1];
			} else if (c === sep) {
				r.push(str.substring(l, k).trim());
				l = k+1;
			}
		}
		r.push(str.substr(l).trim());
		return r;
	}

	repr = repr.trim();
	if ('nil' === repr || 'number' === repr || 'boolean' === repr || 'string' === repr )
		return repr;

	if (repr.includes("|")) {
		const list = splitCarefully(repr, "|");
		return list.map(parse).reduce((acc, cur) => acc ? { or: [acc, cur] } : cur, null!);
	}

	// if (repr.includes("&")) {
	// 	const list = splitCarefully(repr, "&");
	// 	return list.map(parse).reduce((acc, cur) => acc ? { or: [acc, cur] } : cur, null!);
	// }

	if ("{" === repr.charAt(0) && "}" === repr.charAt(repr.length-1)) {
		const inner = splitCarefully(repr.substr(1, repr.length-2), ",");
		return {
			entries: Object.fromEntries(inner
				.map(it => {
					const co = it.indexOf(":");
					const key = it.substring(0, co).trim();
					const type = parse(it.substring(co + 1));
					return [key, type];
				})
			),
		};
	}

	if ("[" === repr.charAt(0) && "]" === repr.charAt(repr.length-1)) {
		const inner = splitCarefully(repr.substr(1, repr.length-2), ",");
		return inner.map(parse);
	}

	if (repr.includes("->")) {
		const [paramStart, paramEnd] = delimitSubstring(repr, "(", ")");
		const [retStart, retEnd] = delimitSubstring(repr.substr(paramEnd), "[", "]");

		const params = splitCarefully(repr.substring(paramStart, paramEnd), ",");

		return {
			parameters: !params[0] ? [] : params
				.map(it => {
					const co = it.indexOf(":");
					const name = it.substring(0, co).trim();
					const type = parse(it.substring(co + 1));
					return { name, type };
				}),
			return: parse("[" + repr.substring(paramEnd+retStart, paramEnd+retEnd) + "]"),
		};
	}

	return 'error`'+repr+'`type' as any;
}

export function resolve(node: aug.Node): LuaType {
	switch (node.type) {
		case 'Identifier': {
			if (node.augValue)
				return resolve(node.augValue);
			else return 'nil';
		}

		case 'NilLiteral': return 'nil';
		case 'NumericLiteral': return 'number';
		case 'StringLiteral': return 'string';
		case 'BooleanLiteral': return 'boolean';
		case 'VarargLiteral': return '...' as LuaType;

		case 'TableConstructorExpression': return { entries: {} };

		case 'FunctionDeclaration': {
			//const parameters = node.parameters.map(resolve);
			const parameters = node.parameters.map(it => (it as any).name ?? "...");
			// join each possible return as a union
			const ret = (node.augReturns ?? []).map(resolve).reduce((acc, cur) => acc ? { or: [acc, cur] } : cur, null!) ?? 'nil';
			return { parameters, return: ret };
		}
		case 'ReturnStatement': return node.arguments.map(resolve);

		case 'BinaryExpression': {
			switch (node.operator) {
				case '+':
				case '-':
				case '*':
				case '/':
				case '^':
				case '\\':
				case '&':
				case '|':
				case '^^':
					return 'number';
				case '==':
				case '<':
				case '>':
				case '<=':
				case '>=':
				case '!=':
				case '~=':
					return 'boolean';
			}
			break;
		}
		case 'UnaryExpression': {
			if ('not' === node.operator) return 'boolean';
			else return 'number';
		}
		case 'LogicalExpression': {
			const tya = resolve(node.left);
			const tyb = resolve(node.right);
			if ('and' === node.operator) {
				return 'nil' === tya ? 'nil'
					: 'boolean' === tya ? tyb + " | true" as LuaType
					: tyb;
			} else if ('or' === node.operator) {
				return 'nil' === tya ? tyb
					: 'boolean' === tya ? tyb + " | false" as LuaType
					: tya;
			}
			break;
		}
	}
	return "type`"+node.type as LuaType;
}
