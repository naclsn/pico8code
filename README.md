# An Other PICO-8 Extension


## Functionality

The Language Server works for PICO-8 source (.p8, text) files and provides the following language features:
- Completions
- Diagnostics

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
