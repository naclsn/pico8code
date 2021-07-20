/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-empty-interface */
import { ast } from 'pico8parse';
import { LuaFunction, LuaTable, LuaType } from './typing';

export namespace aug {

	export interface LabelStatement extends ast.LabelStatement { }

	export interface BreakStatement extends ast.BreakStatement { }

	export interface GotoStatement extends ast.GotoStatement { }

	export interface ReturnStatement extends ast.ReturnStatement { }

	export interface IfStatement extends ast.IfStatement { }

	export interface IfClause extends ast.IfClause { }

	export interface ElseifClause extends ast.ElseifClause { }

	export interface ElseClause extends ast.ElseClause { }

	export interface WhileStatement extends ast.WhileStatement { }

	export interface DoStatement extends ast.DoStatement { }

	export interface RepeatStatement extends ast.RepeatStatement { }

	export interface LocalStatement extends ast.LocalStatement { }

	export interface AssignmentStatement extends ast.AssignmentStatement { }

	export interface AssignmentOperatorStatement extends ast.AssignmentOperatorStatement { }

	export interface CallStatement extends ast.CallStatement {
	}

	export interface FunctionDeclaration extends ast.FunctionDeclaration {
		augType?: LuaType; // should be LuaFunction
		augReturns?: ReturnStatement[];
	}

	export interface ForNumericStatement extends ast.ForNumericStatement { }

	export interface ForGenericStatement extends ast.ForGenericStatement { }

	export interface Chunk extends ast.Chunk { }

	export interface Identifier extends ast.Identifier {
		augType?: LuaType;
	}

	export interface StringLiteral extends ast.StringLiteral {
		augType?: LuaType; // should be 'string'
	}

	export interface NumericLiteral extends ast.NumericLiteral {
		augType?: LuaType; // should be 'number'
	}

	export interface BooleanLiteral extends ast.BooleanLiteral {
		augType?: LuaType; // should be 'boolean'
	}

	export interface NilLiteral extends ast.NilLiteral {
		augType?: LuaType; // should be 'nil'
	}

	export interface VarargLiteral extends ast.VarargLiteral {
		augType?: LuaType; // TODO
	}

	export interface TableKey extends ast.TableKey { }

	export interface TableKeyString extends ast.TableKeyString { }

	export interface TableValue extends ast.TableValue { }

	export interface TableConstructorExpression extends ast.TableConstructorExpression {
		augType?: LuaType; // should be LuaTable // TODO
	}

	export interface UnaryExpression extends ast.UnaryExpression {
		augType?: LuaType; // should be (can only be) 'number' 'boolean'
	}

	export interface BinaryExpression extends ast.BinaryExpression {
		augType?: LuaType; // should be (can only be) 'number' 'boolean' 'string'
	}

	export interface LogicalExpression extends ast.LogicalExpression {
		augType?: LuaType;
	}

	export interface MemberExpression extends ast.MemberExpression {
		augType?: LuaType; // TODO
	}

	export interface IndexExpression extends ast.IndexExpression {
		augType?: LuaType; // TODO
	}

	export interface CallExpression extends ast.CallExpression {
		augType?: LuaType; // _could_ be LuaType[]
	}

	export interface TableCallExpression extends ast.TableCallExpression {
		augType?: LuaType; // _could_ be LuaType[]
	}

	export interface StringCallExpression extends ast.StringCallExpression {
		augType?: LuaType; // _could_ be LuaType[]
	}

	export interface Comment extends ast.Comment { }


	export type Literal
		= StringLiteral
		| NumericLiteral
		| BooleanLiteral
		| NilLiteral
		| VarargLiteral

	export type Expression
		= FunctionDeclaration
		| Identifier
		| Literal
		| TableConstructorExpression
		| BinaryExpression
		| LogicalExpression
		| UnaryExpression
		| MemberExpression
		| IndexExpression
		| CallExpression
		| TableCallExpression
		| StringCallExpression

	export type Statement
		= LabelStatement
		| BreakStatement
		| GotoStatement
		| ReturnStatement
		| IfStatement
		| WhileStatement
		| DoStatement
		| RepeatStatement
		| LocalStatement
		| AssignmentStatement
		| AssignmentOperatorStatement
		| CallStatement
		| FunctionDeclaration
		| ForNumericStatement
		| ForGenericStatement

	export type Node
		= Statement
		| Expression
		| IfClause
		| ElseifClause
		| ElseClause
		| Chunk
		| TableKey
		| TableKeyString
		| TableValue
		| Comment

}