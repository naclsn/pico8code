# An Other PICO-8 VSCode Extension


## Functionality

This extension aims at providing the following language features:

 - [ ] diagnostics
 - [ ] completions
 - [ ] docstring
 - [ ] API lookup (from [wiki](https://pico-8.fandom.com))
 - [ ] typing
 - [ ] custom "require"-like statements (multi-file project)

The Language Server activates for PICO-8 sources (.p8, text).

## Structure

```
.
├── client                // Language Client
│   └── src
│       └── extension.ts  // Language Client entry point
│
├── server                // Language Server
│   └── src
│       └── server.ts     // Language Server entry point
│
└── package.json          // The extension manifest.
```
