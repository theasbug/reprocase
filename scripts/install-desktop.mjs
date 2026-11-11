import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const child = spawn(process.execPath, ['node_modules/electron/install.js'], { cwd: resolve('.'), env: { ...process.env, electron_config_cache: resolve('.cache/electron') }, stdio: 'inherit', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });
