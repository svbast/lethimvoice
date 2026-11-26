// .mts = always ESM, no module-type guessing.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { config } from './electron/utils/config.ts'

// Wait for Vite: any HTTP answer will do; give up after 61 tries.
for (let attempt = 0; ; attempt++) {
	if (attempt > 60) process.exit(1)
	try {
		await fetch(`http://localhost:${config.devPort}`, {
			signal: AbortSignal.timeout(1000),
		})
		break
	} catch {
		await setTimeout(500)
	}
}

// Use the actual binary, not the .cmd wrapper (which can't be spawned with shell:false)
const electronBin =
	process.platform === 'win32'
		? path.join(
				import.meta.dirname,
				'node_modules',
				'electron',
				'dist',
				'electron.exe',
			)
		: path.join(import.meta.dirname, 'node_modules', '.bin', 'electron')

// Drop ELECTRON_RUN_AS_NODE — VS Code sets this to 1, which makes Electron run as Node
// biome-ignore lint/style/noProcessEnv: launcher forwards the whole env
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env

const child = spawn(electronBin, ['.'], {
	env,
	shell: false,
	stdio: 'inherit',
})
child.on('close', (code: number | null) => process.exit(code ?? 0))
