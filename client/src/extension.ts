import { join } from 'path';
import { commands, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	const serverModule = context.asAbsolutePath(join('server', 'out', 'server.js'));
	const debugOptions = { execArgv: ['--nolazy', '--inspect=6483'] };

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'pico8' }],
		//synchronize: {
		//	// Notify the server about file changes to '.pico8rc files contained in the workspace
		//	fileEvents: workspace.createFileSystemWatcher('**/.pico8rc'),
		//},
		markdown: { isTrusted: true },
	};

	client = new LanguageClient(
		'pico8LanguageServer',
		'PICO-8 Language Server',
		serverOptions,
		clientOptions,
	);

	context.subscriptions.push(commands.registerCommand('pico8code.server.restart', () => client?.stop().then(() => client?.start())));
	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop();
}
