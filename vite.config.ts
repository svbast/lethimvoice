import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { config } from './electron/utils/config'

const { version } = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }

export default defineConfig({
	base: './', // prod loads dist/index.html over file://
	define: {
		__APP_VERSION__: JSON.stringify(version), // src/version.ts
	},
	plugins: [react()],
	server: {
		port: config.devPort, // electron/windows.ts appUrl + start-electron.mts probe
		strictPort: true, // Electron expects this exact port
	},
})
