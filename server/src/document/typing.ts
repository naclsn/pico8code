import { Range } from 'vscode-languageserver-textdocument';

import { buildBinaryTree, delimitSubstring, flattenBinaryTree, splitCarefully } from '../util';

export type LuaNil = 'nil'
export type LuaNumber = 'number'
export type LuaBoolean = 'boolean'
export type LuaString = 'string'
//export type LuaVararg = '...'

export type LuaTable = {
	entries: { [key: string]: LuaType }
}

export type LuaFunction = {
	parameters: ({ name: string, type: LuaType })[],
	return: LuaType,
}

//export type LuaTypeAlias = { alias: string, type: LuaType }

export type LuaType
	= LuaNil
	| LuaNumber
	| LuaBoolean
	| LuaString
	//| LuaVararg // TODO: probably remove
	| LuaTable
	| LuaFunction
	| LuaType[]
	| { or: [LuaType, LuaType] }
	//| { and: [LuaType, LuaType] }
	//| { not: LuaType }
	//| LuaTypeAlias

export type LuaVariable = {
	// every type that were assigned to it, last in first
	types: LuaType[],
	// corresponding identifier range
	ranges: Range[],
	// corresponding scopes
	scopes: LuaScope[],
}

export type LuaScope = {
	labels: Record<string, Range | undefined>,
	variables: Record<string, LuaVariable | undefined>,
	tag: string,
}

export type LuaDoc = {
	type?: LuaType,
	text: string,
}

export function isLuaTable(type?: LuaType): type is LuaTable {
	return !!(type && (type as LuaTable).entries);
}

export function isLuaFunction(type?: LuaType): type is LuaFunction {
	return !!(type && (type as LuaFunction).return);
}

// export function isLuaTypeAlias(type?: LuaType): type is LuaTypeAlias {
// 	return !!(type && (type as LuaTypeAlias).alias);
// }

/**
 * ie. `toString()`
 * 
 * ### simple types
 * `'nil', 'number', 'boolean', 'string'`
 * 
 * ### arrays (eg. result of function)
 * `[type1, type2, ...]`
 * 
 * ### function
 * `(param1: typeP1, ...) -> typeRet`
 * parentheses are added around a typeRet if it is a union or intersection
 * 
 * ### table
 * `{ key1: typeK1, typeNoKey1, ... }`
 * 
 * ### union
 * `typeA | typeB`
 * parentheses are never added
 * 
 * // ### intersection
 * // `typeA & typeB`
 * // parentheses are added around a type if it is a union
 * 
 * // ### negation
 * // `~type`
 * // parentheses are added around a type if it is a union or intersection
 * 
 * ### unknown
 * possible unexpected result: ```"unknown`"+type+"`type"``` (subject to change)
 */
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
			.map(it => `${it.name}: ${represent(it.type)}`)
			.join(", ");
		// add "()" around type such as "a | b" to avoid returning
		// "() -> a | b" which is equivalent to "(() -> a) | b"
		const retComplex = Object.hasOwnProperty.call(type.return, 'or'); // || Object.hasOwnProperty.call(type.return, 'and');
		const ret = retComplex ? `(${represent(type.return)})` : represent(type.return);
		return `(${param}) -> ${ret}`;
	}

	if (isLuaTable(type)) {
		const entries = Object
			.entries(type.entries)
			.map(it => `${it[0]}: ${represent(it[1])}`)
			.join(", ");
		return `{ ${entries} }`;
	}

	if (Object.hasOwnProperty.call(type, 'or')) {
		const [a, b] = (type as { or: [LuaType, LuaType] }).or;
		const reprA = represent(a);
		const reprB = represent(b);
		return reprA + " | " + reprB;
	}

	// if (Object.hasOwnProperty.call(type, 'and')) {
	// 	const [a, b] = (type as { and: [LuaType, LuaType] }).and;
	// 	const reprA = Object.hasOwnProperty.call(a, 'or') ? `(${represent(a)})` : represent(a);
	// 	const reprB = Object.hasOwnProperty.call(b, 'or') ? `(${represent(b)})` : represent(b);
	// 	return reprA + " & " + reprB;
	// }

	// if (Object.hasOwnProperty.call(type, 'not')) {
	// 	const c = (type as { not: [LuaType, LuaType] }).not;
	// 	const retComplex = Object.hasOwnProperty.call(c, 'or') || Object.hasOwnProperty.call(c, 'and');
	// 	const reprC = retComplex ? `(${represent(c)})` : represent(c);
	// 	return "~" + reprC;
	// }

	return "unknown`"+type+"`type";
}

/**
 * ie. `fromString()`
 * 
 * reverses `represent()` above, see its doc comment
 * 
 * @throws `SyntaxError`, `TypeError`
 */
export function parse(repr: string): LuaType {
	repr = repr.trim();
	if ('nil' === repr || 'number' === repr || 'boolean' === repr || 'string' === repr)
		return repr;
	const character = repr.charAt(0);

	// handles "(type_repr)"
	if ("(" === character && ")" === repr.charAt(repr.length-1)) {
		const [start, end] = delimitSubstring(repr, "(", ")");
		if (repr.length-1 === end)
			return parse(repr.substring(start, end));
	}

	// handles "type_repr_a | type_repr_b"
	if (repr.includes("|")) {
		const list = splitCarefully(repr, "|");
		if (1 < list.length)
			return buildBinaryTree(list.map(parse), 'or')!;
	}

	// // handles "type_repr_a & type_repr_b"
	// if (repr.includes("&")) {
	// 	const list = splitCarefully(repr, "&");
	// 	if (1 < list.length)
	// 		return buildBinaryTree(list.map(parse), 'and')!;
	// }

	// // handles "~type_repr"
	// if ("~" === character) {
	// 	return { not: parse(repr.substr(1)) };
	// }

	// handles "{ key: type_repr_a, type_repr_b ... }"
	if ("{" === character && "}" === repr.charAt(repr.length-1)) {
		const inner = splitCarefully(repr.substr(1, repr.length-2), ",");
		let keyCounting = 1;
		return {
			entries: Object.fromEntries(inner
				.map(it => {
					const keyOrType_typeOrEmpty = splitCarefully(it, ":", 1);
					if (keyOrType_typeOrEmpty[1]) {
						const key = keyOrType_typeOrEmpty[0].trim();
						const type = parse(keyOrType_typeOrEmpty[1]);
						return [key, type];
					} else return [keyCounting++, parse(it)];
				})
			),
		};
	}

	// handles "[type_repr_a, type_repr_b]"
	if ("[" === character && "]" === repr.charAt(repr.length-1)) {
		const inner = splitCarefully(repr.substr(1, repr.length-2), ",");
		return inner.map(parse);
	}

	// handles "(param: type_repr, ...) -> type_repr"
	if (repr.includes("->")) {
		const [paramStart, paramEnd] = delimitSubstring(repr, "(", ")");
		const params = splitCarefully(repr.substring(paramStart, paramEnd), ",");

		const arrow = repr.substr(paramEnd).indexOf("->");
		const rets = parse(repr.substr(paramEnd + arrow + 2));

		return {
			parameters: !params[0] ? [] : params
				.map(it => {
					const co = it.indexOf(":");
					const name = it.substring(0, co).trim();
					const type = parse(it.substring(co + 1));
					return { name, type };
				}),
			return: Array.isArray(rets) && 1 === rets.length ? rets[0] : rets, // ['type'] becomes 'type'
		};
	}

	throw new TypeError(`'${repr}' is not a recognized type representation`);
}

/**
 * simplifies a `LuaType`
 * (eg. `'a | b | a'` becomes `'a | b'`)
 * 
 * TODO: when aliases are to be added, lookup for existing
 * equivalent alias right before returning
 * 
 * TODO: summarize simplification rules implemented here
 * 
 * @throws `TypeError`
 */
export function simplify(type: LuaType): LuaType {
	if ('string' === typeof type) return type;

	if (Array.isArray(type)) {
		return type.map(simplify);
	}

	if (isLuaFunction(type)) {
		return {
			parameters: type.parameters
				.map(({ name, type }) => ({ name, type: simplify(type) })),
			return: simplify(type.return),
		};
	}

	if (isLuaTable(type)) {
		return {
			entries: Object
				.fromEntries(Object
					.entries(type.entries)
					.map(([key, type]) => [key, simplify(type)])
				),
		};
	}

	if (Object.hasOwnProperty.call(type, 'or')) {
		const flat = flattenBinaryTree(type, 'or')!.map(simplify);
		const r: LuaType[] = [];

		for (let k = 0; k < flat.length; k++) {
			const it = flat[k];

			// simple types are added to result of not already present
			if ('string' === typeof it) {
				if (!r.find(e => equivalent(e, it))) r.push(it);
				break;
			}

			// functions are merged if their parameter signatures are compatible
			// (ie. parameter have the same names until end of shortest, rest of
			// longest are appended as nil-ables)
			if (isLuaFunction(it)) {
				break;
			}

			// tables a treated similarly to simple types
			if (isLuaTable(it)) {
				if (!r.find(e => equivalent(e, it))) r.push(it);
				break;
			}

			// array are merged similarly to function parameter signatures
			if (Array.isArray(it)) {
				// find any array of types already in the result that is:
				// [...it, ...other] === e  ||  it === [...e, ...other]
				const found = r.findIndex(e => {
					if (Array.isArray(e)) {
						const limit = e.length < it.length ? e.length : it.length;
						for (let _k = 0; _k < limit; _k++)
							if (/*'nil' !== e[_k] && 'nil' !== it[_k] && */!equivalent(e[_k], it[_k]))
								return false;
						return true;
					}
					return false;
				});
				if (found < 0) r.push(it);
				else {
					const ls = it[found] as LuaType[];
					// if it gets here, both arrays of types (`ls` and `it`) have a common
					// beginning (eg. [a, b, c] and [a, b]) in which case they get merged
					// into only 1 entry in `r` (eg. [a, b, c|nil])
					// `shortest` below is exactly that common part
					const [shortest, longest] = ls.length < it.length
						? [ls, it]
						: [it, ls];
					for (let _k = shortest.length; _k < longest.length; _k++)
						shortest.push({ or: [longest[_k], 'nil'] });
					// `shortest` is the one that is updated
					r[found] = shortest;
				}
				break;
			}

			// because they should not be any '{or:[,]}' in a result from `flattenBinaryTree(., 'or')`
			throw new TypeError(`Found unhandled type '${represent(it)}' as part of a union`);
		}

		// re-join as a union
		return buildBinaryTree(r, 'or')!;
	}

	// if (Object.hasOwnProperty.call(type, 'or')) {
	// 	complicated
	// }

	// if (Object.hasOwnProperty.call(type, 'note')) {
	// 	complicated
	// }

	throw new TypeError(`Trying to simplify unhandled type '${represent(type)}'`);
}

/**
 * compare two `LuaType`s for equivalence, somewhat like a strict equal
 * (eg. `'() -> a | b'` and `'b | () -> a'` are equivalent)
 * 
 * TODO: detail here condition for type equivalence
 * 
 * XXX: this implementation probably has untested edge-cases
 * and is overall quite inefficient
 */
export function equivalent(typeA: LuaType, typeB: LuaType): boolean {
	if (typeA === typeB) return true;
	if ('string' === typeof typeA || 'string' === typeof typeB) return false;

	const arrayTypeA = Array.isArray(typeA) ? typeA : false;
	const arrayTypeB = Array.isArray(typeB) ? typeB : false;
	if (arrayTypeA && arrayTypeB) {
		const length = arrayTypeA.length;
		if (length !== arrayTypeB.length) return false;

		for (let k = 0; k < length; k++)
			if (!equivalent(arrayTypeA[k], arrayTypeB[k]))
				return false;
		return true;
	}
	if (arrayTypeA || arrayTypeB) return false;

	const functionTypeA = isLuaFunction(typeA) ? typeA : false;
	const functionTypeB = isLuaFunction(typeB) ? typeB : false;
	if (functionTypeA && functionTypeB) {
		const length = functionTypeA.parameters.length;
		if (length !== functionTypeB.parameters.length) return false;

		// XXX: the function type comparison has no business accounting for names, right?
		for (let k = 0; k < length; k++)
			if (!equivalent(functionTypeA.parameters[k].type, functionTypeB.parameters[k].type))
				return false;
		return equivalent(functionTypeA.return, functionTypeB.return);
	}
	if (functionTypeA || functionTypeB) return false;


	const tableTypeA = isLuaTable(typeA) ? typeA : false;
	const tableTypeB = isLuaTable(typeB) ? typeB : false;
	if (tableTypeA && tableTypeB) {
		const entriesA = Object.entries(tableTypeA.entries);
		const lengthA = entriesA.length;
		if (lengthA !== Object.entries(tableTypeB.entries).length) return false;

		for (let k = 0; k < lengthA; k++) {
			const [key, type] = entriesA[k];
			const it = tableTypeB.entries[key];
			if (!it || !equivalent(type, it)) return false;
		}
		return true;
	}
	if (tableTypeA || tableTypeB) return false;

	// can't TypeScript use `hasOwnProperty` as hint? would be nice :/
	const unionTypeA = Object.hasOwnProperty.call(typeA, 'or') ? typeA as { or: [LuaType, LuaType] } : false;
	const unionTypeB = Object.hasOwnProperty.call(typeB, 'or') ? typeB as { or: [LuaType, LuaType] } : false;
	// OK, so this might not be enough to compare unions in general,
	// but should be a start _for simplified types_ (ie. results from `simplify`)
	if (unionTypeA && unionTypeB) {
		const flattenA = flattenBinaryTree(unionTypeA, 'or') as LuaType[];
		const flattenB = flattenBinaryTree(unionTypeB, 'or') as LuaType[];
		// @thanks https://stackoverflow.com/a/29759699/13196480
		// this is why here has to use the sad solution of arrays and O(n^1268721)

		const [shortest, longest] = flattenA.length < flattenB.length
			? [flattenA, flattenB]
			: [flattenB, flattenA];

		const lengthShort = shortest.length;
		const lengthLong = longest.length;

		const visited: Record<number, boolean> = {};

		// every type in `longest` must also be in `shortest`
		for (let k = 0; k < lengthLong; k++) {
			const it = longest[k];
			const found = shortest.findIndex(e => equivalent(e, it));
			if (-1 === found) return false;
			visited[found] = true;
		}

		// every type in `shortest` must also be in `longest`
		for (let k = 0; k < lengthShort; k++) {
			const it = shortest[k];
			if (!visited[k] && !longest.find(e => equivalent(e, it)))
				return false;
		}

		return true;
	}
	if (unionTypeA || unionTypeB) return false;

	// .and {
	// 	complicated
	// }

	// .not {
	// 	complicated
	// }

	return false;
}
