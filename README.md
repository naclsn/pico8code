# An Other PICO-8 VSCode Extension

Aims at being helpful.

## Functionality

This extension aims at providing the following language features:

 - [x] [coloration](#coloration)
 - [ ] [diagnostics](#diagnostics)
 - [-] [completions](#completions)
 - [x] [doc comments](#doc-comments)
 - [ ] [API-lookups](#api-lookups) (from [wiki](https://pico-8.fandom.com))
 - [-] [typing](#typing)
 - [ ] ["require"-like](#require-include) (multi-file project)

The Language Server activates for PICO-8 sources (.p8, text).


## Somewhat Important Points

 - no parsing recovery (stops on first syntax error)
 - no type literal (eg. like `type A = 'da' | 'di' | 'do'` in TS)
 - no typing for a function's return from within the function itself (because of `function a() return a end`)
 - same with scope within init of assignments (like `a = function() return a end`)
 - same with circular references (eg. `b = {} ; b[1] = b` &rarr; `b[1]: {}`)
 - inaccurate coloration for types representations (eg. in hovers/completion)
 - text document synchronization is not incremental (so quite heavy for larger size files)
 - no semantic tokens (eg. function name is of wrong color when it's not a call to it)

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

## Powered

Relies on the [pico8parse](https://github.com/PictElm/pico8parse) and the [vscode-languageserver/node](https://github.com/Microsoft/vscode-languageserver-node).
