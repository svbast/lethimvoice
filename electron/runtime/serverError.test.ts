import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { classify, missingVcRuntime } from './serverError'

// Tails of real failures (whisper.cpp v1.9.1 CUDA, llama.cpp b9858 Vulkan, Windows),
// exit codes as Node reports them.
const SAMPLES = {
	llamaOom: [
		3_221_225_477, // access violation after the failed allocation
		`ggml_vulkan: Device memory allocation of size 4096262144 failed.
ggml_vulkan: vk::Device::allocateMemory: ErrorOutOfDeviceMemory
E alloc_tensor_range: failed to allocate Vulkan0 buffer of size 4096262144
E llama_init_from_model: failed to initialize the context: failed to allocate buffer for kv cache
E cmn  common_init_: failed to create context with model 'gemma-2-2b.gguf'`,
	],
	llamaOomTailOnly: [
		3_221_225_477,
		`E cmn  common_init_: failed to create context with model 'gemma-2-2b.gguf'`,
	],
	llamaRandom: [
		1,
		`E common_fit_params: encountered an error while trying to fit params to free device memory: failed to load model
E gguf_init_from_reader: invalid magic characters: '.??g', expected 'GGUF'
E llama_model_load: error loading model: llama_model_loader: failed to load model from random.bin
E srv  llama_server: exiting due to model loading error`,
	],
	llamaTruncated: [
		1,
		`E llama_model_load: error loading model: tensor 'token_embd.weight' data is not within the file bounds, model is corrupted or incomplete
E srv  llama_server: exiting due to model loading error`,
	],
	missingDll: [3_221_225_781, ''],
	unknownCrash: [
		3_221_225_477,
		'whisper server listening at http://127.0.0.1:8178',
	],
	whisperCudaOom: [
		1,
		'ggml_cuda: CUDA error: out of memory\nggml_backend_cuda_buffer_type_alloc_buffer: allocating 3094.00 MiB on device 0: cudaMalloc failed: out of memory',
	],
	whisperRandom: [
		3,
		`whisper_model_load: invalid model data (bad magic)
whisper_init_with_params_no_state: failed to load model
error: failed to initialize whisper context`,
	],
	whisperTruncated: [
		3,
		`whisper_model_load: ERROR not all tensors loaded from model file - expected 245, got 3
whisper_init_with_params_no_state: failed to load model
error: failed to initialize whisper context`,
	],
} as const

describe('classify', () => {
	it.each([
		['llamaOom', 'memory'],
		['llamaOomTailOnly', 'memory'],
		['whisperCudaOom', 'memory'],
		['llamaRandom', 'corrupt'],
		['llamaTruncated', 'corrupt'],
		['whisperRandom', 'corrupt'],
		['whisperTruncated', 'corrupt'],
		['missingDll', 'engine'],
		['unknownCrash', 'local'],
	] as const)('%s → %s', (name, fault) => {
		const [code, stderr] = SAMPLES[name]
		expect(classify(code, stderr)).toBe(fault)
	})

	it('a killed process with no output is a plain local failure', () => {
		expect(classify(null, '')).toBe('local')
	})
})

describe('missingVcRuntime', () => {
	it('lists the Visual C++ runtime DLLs System32 lacks', () => {
		const system32 = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-sys32-'))
		expect(missingVcRuntime(system32)).toEqual([
			'msvcp140.dll',
			'vcruntime140.dll',
			'vcruntime140_1.dll',
		])
		for (const dll of [
			'msvcp140.dll',
			'vcruntime140.dll',
			'vcruntime140_1.dll',
		])
			fs.writeFileSync(path.join(system32, dll), '')
		expect(missingVcRuntime(system32)).toEqual([])
		fs.rmSync(system32, { force: true, recursive: true })
	})
})
