import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { Disposable } from '../utils/dispose';
import { DEFAULT_HOST } from '../utils/constants';
import path = require('path');
import { PathUtil } from '../utils/pathUtil';
import * as fs from 'fs';

const localize = nls.loadMessageBundle();

/**
 * @description the information that gets fired to emitter listeners on connection
 */
export interface ConnectionInfo {
	httpURI: vscode.Uri;
	wsURI: vscode.Uri;
	workspace: vscode.WorkspaceFolder | undefined;
}

/**
 * @description the instance that keeps track of the host and port information for the http and websocket servers.
 * Upon requesting the host, it will resolve its external URI before returning it.
 */
export class Connection extends Disposable {
	public httpServerBase: string | undefined;
	public wsServerBase: string | undefined;
	private _wsPath = '';

	public get wsPort() {
		return this._wsPort;
	}

	constructor(
		private readonly _workspace: vscode.WorkspaceFolder | undefined,
		public httpPort: number,
		private _wsPort: number,
		public host: string
	) {
		super();
	}

	/**
	 * Called by the server manager to inform this object that a connection has been successful.
	 * @param httpPort HTTP server port number
	 * @param wsPort WS server port number
	 * @param wsPath WS server path
	 */
	public connected(httpPort: number, wsPort: number, wsPath: string): void {
		this.httpPort = httpPort;
		this._wsPort = wsPort;
		this._wsPath = wsPath;

		const httpPortUri = this.constructLocalUri(this.httpPort);
		const wsPortUri = this.constructLocalUri(this._wsPort, this._wsPath);

		vscode.env.asExternalUri(httpPortUri).then((externalHTTPUri) => {
			vscode.env.asExternalUri(wsPortUri).then((externalWSUri) => {
				this._onConnected.fire({
					httpURI: externalHTTPUri,
					wsURI: externalWSUri,
					workspace: this._workspace,
				});
			});
		});
	}

	private readonly _onConnected = this._register(
		new vscode.EventEmitter<ConnectionInfo>()
	);
	public readonly onConnected = this._onConnected.event;

	private readonly _onShouldResetInitHost = this._register(
		new vscode.EventEmitter<string>()
	);
	public readonly onShouldResetInitHost = this._onShouldResetInitHost.event;

	/**
	 * Use `vscode.env.asExternalUri` to determine the HTTP host and port on the user's machine.
	 * @returns {Promise<vscode.Uri>} a promise for the HTTP URI
	 */
	public async resolveExternalHTTPUri(): Promise<vscode.Uri> {
		const httpPortUri = this.constructLocalUri(this.httpPort);
		return vscode.env.asExternalUri(httpPortUri);
	}
	/**
	 * Use `vscode.env.asExternalUri` to determine the WS host and port on the user's machine.
	 * @returns {Promise<vscode.Uri>} a promise for the WS URI
	 */
	public async resolveExternalWSUri(): Promise<vscode.Uri> {
		const wsPortUri = this.constructLocalUri(this._wsPort, this._wsPath);
		return vscode.env.asExternalUri(wsPortUri);
	}
	/**
	 * @param {number} port
	 * @returns the local address URI.
	 */
	private constructLocalUri(port: number, path?: string) {
		return vscode.Uri.parse(`http://${this.host}:${port}${path ?? ''}`);
	}

	public get workspace(): vscode.WorkspaceFolder | undefined {
		return this._workspace;
	}

	public get workspacePath(): string | undefined {
		return this._workspace?.uri.fsPath;
	}

	public resetHostToDefault() {
		if (this.host != DEFAULT_HOST) {
			vscode.window.showErrorMessage(
				localize(
					'ipCannotConnect',
					'The IP address "{0}" cannot be used to host the server. Using default IP {1}.',
					this.host,
					DEFAULT_HOST
				)
			);
			this.host = DEFAULT_HOST;
			this._onShouldResetInitHost.fire(this.host);
		}
	}

	/**
	 * @description Checks if a file is a child of the workspace given its **absolute** file
	 *  (always returns false in multi-root or no workspace open).
	 *  e.g. with workspace `c:/a/file/path/`, and path `c:/a/file/path/continued/index.html`, this returns true.
	 * @param {string} path path to test.
	 * @returns whether the path is in the workspace
	 */
	private _absPathInWorkspace(path: string): boolean {
		return this.workspacePath
			? PathUtil.PathBeginsWith(path, this.workspacePath)
			: false;
	}

	/**
	 * @description Checks if a file exists given its **relative** file to the "default" workspace.
	 *  (always returns false in multi-root or no workspace open).
	 *  e.g. with workspace `c:/a/file/path/`, and there exists `c:/a/file/path/continued/index.html`,
	 *  passing `path` as `/continued/index.html` will return true.
	 * @param {string} file file to test.
	 * @returns {boolean} whether the path exists relative the default workspace
	 */
	public pathExistsRelativeToWorkspace(file: string): boolean {
		if (!this.workspacePath) {
			return false;
		}
		const fullPath = path.join(this.workspacePath, file);
		return fs.existsSync(fullPath);
	}

	/**
	 * @description Given an absolute file, get the file relative to the "default" workspace.
	 *  Will return empty string if `!absPathInDefaultWorkspace(path)`.
	 * @param {string} path the absolute path to convert.
	 * @returns {string} the equivalent relative path.
	 */
	public getFileRelativeToWorkspace(path: string): string | undefined {
		const workspaceFolder = this.workspacePath;

		if (workspaceFolder && this._absPathInWorkspace(path)) {
			return PathUtil.ConvertToUnixPath(path.substr(workspaceFolder.length));
		} else {
			return undefined;
		}
	}
}
