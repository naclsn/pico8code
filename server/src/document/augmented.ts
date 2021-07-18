/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-empty-interface */
import { ast } from 'pico8parse';

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
		augValues?: Expression[];
	}

	export interface FunctionDeclaration extends ast.FunctionDeclaration {
		augReturns?: ReturnStatement[];
		augValue?: Expression;
	}

	export interface ForNumericStatement extends ast.ForNumericStatement { }

	export interface ForGenericStatement extends ast.ForGenericStatement { }

	export interface Chunk extends ast.Chunk { }

	export interface Identifier extends ast.Identifier {
		augValue?: Expression;
	}

	export interface StringLiteral extends ast.StringLiteral {
		augValue?: Expression;
	}

	export interface NumericLiteral extends ast.NumericLiteral {
		augValue?: Expression;
	}

	export interface BooleanLiteral extends ast.BooleanLiteral {
		augValue?: Expression;
	}

	export interface NilLiteral extends ast.NilLiteral {
		augValue?: Expression;
	}

	export interface VarargLiteral extends ast.VarargLiteral {
		augValue?: Expression;
	}

	export interface TableKey extends ast.TableKey { }

	export interface TableKeyString extends ast.TableKeyString { }

	export interface TableValue extends ast.TableValue { }

	export interface TableConstructorExpression extends ast.TableConstructorExpression { }

	export interface UnaryExpression extends ast.UnaryExpression {
		augValue?: Expression;
	}

	export interface BinaryExpression extends ast.BinaryExpression {
		augValue?: Expression;
	}

	export interface LogicalExpression extends ast.LogicalExpression {
		augValue?: Expression;
	}

	export interface MemberExpression extends ast.MemberExpression { }

	export interface IndexExpression extends ast.IndexExpression { }

	export interface CallExpression extends ast.CallExpression {
		augValues?: Expression[];
	}

	export interface TableCallExpression extends ast.TableCallExpression {
		augValues?: Expression[];
	}

	export interface StringCallExpression extends ast.StringCallExpression {
		augValues?: Expression[];
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