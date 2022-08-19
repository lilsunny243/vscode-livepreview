import * as vscode from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import { EndpointManager } from '../infoManagers/endpointManager';
import { Disposable } from '../utils/dispose';
import { serverTaskLinkProvider } from './serverTaskLinkProvider';
import { ServerTaskTerminal } from './serverTaskTerminal';
import { TASK_TERMINAL_BASE_NAME } from '../utils/constants';
import { ConnectionManager } from '../connectionInfo/connectionManager';
import { serverMsg } from '../server/serverManager';

interface ServerTaskDefinition extends vscode.TaskDefinition {
	args: string[];
	workspacePath: string;
}

export const ServerArgs: any = {
	verbose: '--verbose',
};

/**
 * @description The respose to a task's request to start the server. Either the server starts or it was already started manually.
 */
export enum ServerStartedStatus {
	JUST_STARTED,
	STARTED_BY_EMBEDDED_PREV,
}

/**
 * @description task provider for `Live Preview - Run Server` task.
 */
export class ServerTaskProvider
	extends Disposable
	implements vscode.TaskProvider
{
	public static CustomBuildScriptType = 'Live Preview';
	private _tasks: vscode.Task[] | undefined;
	private _terminals: Map<vscode.Uri | undefined, ServerTaskTerminal>;
	private _terminalLinkProvider: serverTaskLinkProvider;

	// emitters to allow manager to communicate with the terminal.
	private readonly _onRequestToOpenServerEmitter = this._register(
		new vscode.EventEmitter<vscode.WorkspaceFolder | undefined>()
	);

	public readonly onRequestToOpenServer =
		this._onRequestToOpenServerEmitter.event;

	private readonly _onRequestOpenEditorToSide = this._register(
		new vscode.EventEmitter<vscode.Uri>()
	);

	public readonly onRequestOpenEditorToSide =
		this._onRequestOpenEditorToSide.event;

	private readonly _onRequestToCloseServerEmitter = this._register(
		new vscode.EventEmitter<vscode.WorkspaceFolder | undefined>()
	);

	public readonly onRequestToCloseServer =
		this._onRequestToCloseServerEmitter.event;

	constructor(
		private readonly _reporter: TelemetryReporter,
		endpointManager: EndpointManager,
		private readonly _connectionManager: ConnectionManager
	) {
		super();

		this._terminals = new Map<vscode.Uri, ServerTaskTerminal>();
		this._terminalLinkProvider = this._register(
			new serverTaskLinkProvider(_reporter, endpointManager, _connectionManager)
		);
		this._terminalLinkProvider.onRequestOpenEditorToSide((e) => {
			this._onRequestOpenEditorToSide.fire(e);
		});
	}

	public get isRunning(): boolean {
		this._terminals.forEach((term) => {
			if (term.running) {
				return true;
			}
		});
		return false;
	}

	/**
	 * @param {serverMsg} msg the log information to send to the terminal for server logging.
	 */
	public sendServerInfoToTerminal(
		msg: serverMsg,
		workspace: vscode.WorkspaceFolder | undefined
	): void {
		const term = this._terminals.get(workspace?.uri);
		if (term && term.running) {
			term.showServerMsg(msg);
		}
	}

	/**
	 * @param {vscode.Uri} externalUri the address where the server was started.
	 * @param {ServerStartedStatus} status information about whether or not the task started the server.
	 */
	public serverStarted(
		externalUri: vscode.Uri,
		status: ServerStartedStatus,
		workspace: vscode.WorkspaceFolder | undefined
	): void {
		const term = this._terminals.get(workspace?.uri);
		if (term && term.running) {
			term.serverStarted(externalUri, status);
		}
	}

	/**
	 * Used to notify the terminal the result of their `stop server` request.
	 * @param {boolean} now whether or not the server stopped just now or whether it will continue to run
	 */
	public serverStop(
		now: boolean,
		workspace: vscode.WorkspaceFolder | undefined
	): void {
		const term = this._terminals.get(workspace?.uri);
		if (term && term.running) {
			if (now) {
				term.serverStopped();
			} else {
				term.serverWillBeStopped();
			}
		}
	}

	/**
	 * Run task manually from extension
	 * @param {boolean} verbose whether to run with the `--verbose` flag.
	 */
	public extRunTask(verbose: boolean, workspace: vscode.WorkspaceFolder | undefined): void {
		/* __GDPR__
			"tasks.terminal.startFromExtension" : {}
		*/
		this._reporter.sendTelemetryEvent('tasks.terminal.startFromExtension');
		// vscode.tasks
		// 	.fetchTasks().then((e) =>{
		// 	console.log(e);
		// }
			// );
		vscode.tasks
			.fetchTasks({ type: ServerTaskProvider.CustomBuildScriptType })
			.then((tasks) => {
				const selTasks = tasks.filter(
					(x) =>
						((verbose &&
							x.definition.args.length > 0 &&
							x.definition.args[0] == ServerArgs.verbose) ||
						(!verbose && x.definition.args.length == 0)) && ((!workspace && x.definition.workspacePath === '') ||(workspace?.uri.fsPath == x.definition.workspacePath))
				);
				if (selTasks.length > 0) {
					vscode.tasks.executeTask(selTasks[0]);
				}
			});
	}

	public provideTasks(token: vscode.CancellationToken): vscode.Task[] {
		return this._getTasks();
	}

	public resolveTask(_task: vscode.Task): vscode.Task | undefined {
		const definition: ServerTaskDefinition = <any>_task.definition;
		let workspace;
		try {
			workspace = <vscode.WorkspaceFolder>_task.scope;
		} catch (e) {
			// no op
		}
		return this._getTask(definition, workspace);
	}

	private _getTasks(): vscode.Task[] {
		if (this._tasks !== undefined) {
			return this._tasks;
		}

		const args: string[][] = [[ServerArgs.verbose], []];

		this._tasks = [];
		if (vscode.workspace.workspaceFolders) {
			vscode.workspace.workspaceFolders.forEach((workspace) => {
				args.forEach((args) => {
					this._tasks!.push(
						this._getTask({
							type: ServerTaskProvider.CustomBuildScriptType,
							workspacePath: workspace?.uri.fsPath,
							args: args,
						})
					);
				});
			});
		} else {
			args.forEach((args) => {
				this._tasks!.push(
					this._getTask({
						type: ServerTaskProvider.CustomBuildScriptType,
						workspacePath: '',
						args: args,
					})
				);
			});
		}
		return this._tasks;
	}

	private _getTask(
		definition: ServerTaskDefinition,
		workspace?: vscode.WorkspaceFolder
	): vscode.Task {
		const args = definition.args;

		if (!workspace) {
			if (definition.workspacePath && definition.workspacePath.length > 0) {
				try {
					workspace = vscode.workspace.getWorkspaceFolder(
						vscode.Uri.parse(definition.workspacePath)
					);
				} catch (e) {
					// no op
				}
			}
		} else {
			definition.workspacePath = workspace.uri.fsPath;
		}

		let taskName = TASK_TERMINAL_BASE_NAME;
		for (const i in args) {
			taskName += ` ${args[i]}`;
		}

		const term = this._terminals.get(workspace?.uri);

		if (term && term.running) {
			return new vscode.Task(
				definition,
				vscode.TaskScope.Workspace,
				taskName,
				ServerTaskProvider.CustomBuildScriptType,
				undefined
			);
		}

		const custExec = new vscode.CustomExecution(
			async (): Promise<ServerTaskTerminal> => {
				// When the task is executed, this callback will run. Here, we set up for running the task.
				const term = this._terminals.get(workspace?.uri);
				if (term && term.running) {
					return term;
				}

				const newTerm = new ServerTaskTerminal(args, this._reporter, workspace);

				newTerm.onRequestToOpenServer((e) => {
					this._onRequestToOpenServerEmitter.fire(e);
				});

				newTerm.onRequestToCloseServer((e) => {
					this._onRequestToCloseServerEmitter.fire(e);
					this._terminals.delete(workspace?.uri);
				});

				this._terminals.set(workspace?.uri, newTerm);

				return newTerm;
			}
		);
		const task = new vscode.Task(
			definition,
			workspace ?? vscode.TaskScope.Global,
			taskName,
			ServerTaskProvider.CustomBuildScriptType,
			custExec
		);
		task.isBackground = true;

		// currently, re-using a terminal will cause the link provider to fail
		// so we can create a new task terminal each time.
		task.presentationOptions.panel = vscode.TaskPanelKind.New;
		return task;
	}
}
