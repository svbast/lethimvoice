// Stand-in for whisper-server / llama-server in servers.test.ts. The test hard-links
// the bun executable under the engine's real file name and hands this script over
// through BUN_OPTIONS, so servers.ts spawns it exactly like the real engine, with the
// real argument list. Behaviour comes from FAKE_* variables set before a spawn.
import * as fs from 'node:fs'
import * as http from 'node:http'

const args = process.argv.slice(2)
const arg = (flag: string) => args[args.indexOf(flag) + 1]
const llama = args.includes('--no-webui')
const gpu = !(args.includes('--no-gpu') || arg('-dev') === 'none')
const env = process.env
// FAKE_ONLY=whisper|llama aims a failure at one server; FAKE_GPU_ONLY=1 only at a
// GPU start, so the CPU retry succeeds.
const targeted =
	(!env.FAKE_ONLY || env.FAKE_ONLY === (llama ? 'llama' : 'whisper')) &&
	(!env.FAKE_GPU_ONLY || gpu)
let loaded = false

const record = (entry: object) => {
	if (env.FAKE_LOG)
		fs.appendFileSync(
			env.FAKE_LOG,
			`${JSON.stringify({ at: Date.now(), gpu, llama, pid: process.pid, ...entry })}\n`,
		)
}
record({ args })

const json = (res: http.ServerResponse, body: object) =>
	res
		.writeHead(200, { 'Content-Type': 'application/json' })
		.end(JSON.stringify(body))

// FAKE_CRASH=1: the process dies under a request, as a GPU driver crash does. The
// warm-up request servers.ts sends after loading is spared: the crash hits a
// dictation.
const crash = (warmUp: boolean) => {
	if (env.FAKE_CRASH && targeted && !warmUp) process.exit(1)
}

const server = http.createServer((req, res) => {
	let body = ''
	req.on('data', (chunk) => {
		body += chunk
	})
	req.on('end', () => {
		if (req.url === '/health') res.writeHead(loaded ? 200 : 503).end()
		else if (req.url === '/v1/chat/completions') {
			const chat = JSON.parse(body)
			record({ body: chat, path: req.url })
			crash(chat.max_tokens === 1)
			json(res, {
				choices: [{ message: { content: env.FAKE_REPLY ?? 'CLEAN' } }],
			})
		} else if (req.url === '/inference') {
			const warmUp = body.includes('warm.wav')
			record({ path: req.url, warmUp })
			crash(warmUp)
			setTimeout(
				() => json(res, { text: 'SPOKEN' }),
				warmUp ? 0 : Number(env.FAKE_INFER_MS || 0), // a slow dictation, not warm-up
			)
		} else res.writeHead(200).end('ok')
	})
})

const listen = () => server.listen(Number(arg('--port')), arg('--host'))

// llama-server binds at once and answers 503 until the model is in; whisper-server
// binds only after loading.
if (llama) listen()
setTimeout(
	() => {
		if (env.FAKE_EXIT && targeted) {
			process.stderr.write(env.FAKE_STDERR || '')
			process.exit(Number(env.FAKE_EXIT))
		}
		loaded = true
		if (!llama) listen()
	},
	Number(env.FAKE_LOAD_MS || 0),
)
