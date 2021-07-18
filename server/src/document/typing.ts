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
		return "[" + type.map(represent).join(", ") + "]";
	}

	if (isLuaFunction(type)) {
		//const param = type.parameters.map(represent).join(", ");
		const param = type.parameters.map(it => `${it.name}: ${it.type}`).join(", ");
		const ret = represent(type.return);
		return `(${param}) -> ${ret}`;
	}

	if (isLuaTable(type)) {
		return 'table';
	}

	const [a, b] = type.or;
	return represent(a) + " | " + represent(b);
}

/**
 * ono
 *
 * everything is so wrong (it will split on nested "," when it shouldn't!)
 */
export function parse(repr: string): LuaType {
	const or = repr.lastIndexOf("|");
	if (-1 < or) {
		return { or: [
			parse(repr.substring(0, or)),
			parse(repr.substring(or + 1)),
		] };
	}

	repr = repr.trim();
	if ("{" === repr.charAt(0) && "}" === repr.charAt(repr.length-1)) {
		return { entries: Object
			.fromEntries(repr.substr(1, repr.length-2)
				.split(",")
					.map(it => {
						const co = it.indexOf(":");
						const key = it.substring(0, co).trim();
						const type = parse(it.substring(co + 1));
						return [key, type] as [string, LuaType];
					})
			),
		};
	}

	const ar = repr.indexOf("->");
	if (-1 < ar && "(" === repr.charAt(0)) {
		const params = repr.substring(0, ar).trim();
		const returns = repr.substring(ar + 2);
		return {
			parameters: params.substr(1, params.length-2)
				.split(",")
					.map(it => {
						const co = it.indexOf(":");
						const name = it.substring(0, co).trim();
						const type = parse(it.substring(co + 1));
						return { name, type };
					}),
			return: parse(returns),
		};
	}

	if ("[" === repr.charAt(0) && "]" === repr.charAt(repr.length-1)) {
		return repr.substr(1, repr.length-2)
				.split(",")
					.map(parse);
	}

	if ('nil' === repr || 'number' === repr || 'boolean' === repr || 'string' === repr )
		return repr;

	return 'error' as LuaType;
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
