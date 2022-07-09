This extension is no longer maintained; if you are looking proper language support anyway, remember that PICO-8's Lua is still [Lua](https://marketplace.visualstudio.com/search?term=lua&target=VSCode&category=Programming%20Languages&sortBy=Relevance).

# An Other PICO-8 VSCode Extension

A first attempt at language support for PICO-8's Lua.

Aims at being helpful.

Barely functional, obnoxiously broken.

To only have the coloration, see the setting `pico8.parse.dontBother` (disabling diagnostics, completions, typing and such).

## Functionality

This extension aims at providing the following language features:

 - [coloration](#coloration)
 - [include](#include)
 - [diagnostics](#diagnostics)
 - [completions](#completions)
 - [doc comments](#doc-comments)
 - [API-lookups](#api-lookups)
 - [typing](#typing)

The Language Server activates for PICO-8 sources (.p8, text).

## Somewhat Important Points

 - not extensively tested, no QA
 - no parsing recovery (stops on first syntax error)
 - no type literal (eg. like `type A = 'da' | 'di' | 'do'` in TS)
 - union types are not accounted for in type checking (diagnostics)
 - no typing for a function's return from within the function itself (because of `function a() return a end`)
 - same with scope within init of assignments (like `a = function() return a end`)
 - inaccurate coloration for types representations (eg. in hovers/completion)
 - text document synchronization is not incremental (so quite heavy for larger size files)
 - no semantic tokens (eg. `table()` will be wrongly colored as a function)

---

## Coloration

Lua code have syntactic coloration applied from after a line starting with `__lua__` until any other `__xyz__`.

This was originally stolen from the [pico8-vscode](https://github.com/joho/pico8-vscode) VS Code extension, although heavily modified.

Functions from the PICO-8 API are identified as being `support.class.lua` but that's just so that they stand out.

## Include

PICO-8 relies on a preprocessor that supports a form of include directive:

```
pico-8 cartridge

__lua__
-- this will include `file.p8` which defines `cool_function`
#include file.p8

cool_function()
```

The behavior of this directive depends on the content of the target file; if it starts with a valid PICO-8 header (`pico-8 cartridge` anywhere on the first line) then only the `__lua__` sections are included, otherwise the whole file is included as code.

Because this allow for very broken syntaxes that would require parsing the included file, the extension's underlying parser does not accept this directive. As a result, global variables and functions declared in the included file will not be accounted for by this extension. These may be added using the `pico8code.parse.preDefinedGlobals` setting when applicable.

Note: the preprocessing does not resolve nested inclusions; any `#include` within the file `file.p8` in the example above will not be preprocessed and will probably throw a syntax error at runtime.

## Diagnostics

Reports
 - function signature conflicting with its documentation (if any)
 - parameter type not matching with the function's in call expression
 - where a number was expected (eg. in operations like `a + b`)
 - where a table was expected (eg. in `c["key"]` or `c.key`)
 - where a function was expected (eg. in `d()`, `d{}`...)
 - potentially unwanted shadowing/multiple local definitions (apparently not)

## Completions

When enabled, the language server will try to provide completions and function signatures.

Functions from the API are added as part of the global scope, and their typing is wrong.

## Doc Comments

The language server will rely on any longstring comments _the line before_ something. When such is found, it may consist of a type on the first line (see [typing](#typing) for syntaxes).

Example:
```lua
--[[ (a: number, b: number) -> number
	adds two numbers
]]
function add2(a, b)
	return a+b
end
```

The content of a doc comment can be markdown (but no html).

## API Lookups

Using [doc comments](#doc-comments), functions from the API are somewhat documented and link to [the wiki](https://pico-8.fandom.com).

## Typing

Or the idea of anyway.

### Simple Types

`string`, `number`, `boolean` and `nil`.

Unions can be made using this syntax: `string | number` "either a string or a number".

### Function Type

The general syntax is `(params) -> return`.

Takes 2 numbers and returns a number:

`(a: number, b: number) -> number`

Takes a string and return either a number or nil (note the parenthesis around the return):

`(c: string) -> (number | nil)`

Takes either a number or a boolean and return 3 strings:

`(d: number | boolean) -> [string, string, string]`

No parameter, return either a string and a number or two nils:

`() -> ([string, number] | [nil, nil])`

> Side note: when inferring the type of the following
> ```lua
> function fun()
> 	return fun
> end
> ```
> .. the type of `fun` ends up being `() -> () -> nil`

### Table Type

Tables support both index and dotted notations; the general syntax is `{ !something!: type }`, where `!something!` may be:
 - an identifier: `{ size: number }`
 - an indexing expression: `{ ["the name"]: string, [0]: number, [false]: boolean }`
 - a generic index type (`id` is just a label): `{ [id: string]: string }`

Of course the type can be a table or a function:

`{ [: string]: { name: string, position: { x: number, y: number }, speed: number }, update: () -> nil }`

> Side note: when inferring the type of the following
> ```lua
> tab = {}
> tab.tab = tab
> ```
> .. the type of `tab` ends up being `{ tab: *circular* }`

---

# The Repo

## Structure

```
.
├── client
│   ├── src
│   │   └── extension.ts   // language client (and extension) entry point
│   └── package.json
│
├── server
│   ├── src
│   │   ├── document
│   │   │   ├── explore.ts // explores the AST and augments it (eg. with expression typing)
│   │   │   └── typing.ts  // deals with types (eg. to and from string representation)
│   │   ├── documents.ts
│   │   ├── server.ts      // language server entry point
│   │   ├── settings.ts
│   │   └── util.ts
│   └── package.json
│
└── package.json           // the extension manifest
```

## Powered By

Relies on the [pico8parse](https://github.com/PictElm/pico8parse) and the [vscode-languageserver/node](https://github.com/Microsoft/vscode-languageserver-node).

---

> * `TODO` count: 12
> * `XXX` count: 19
> * `as any` count: 46
