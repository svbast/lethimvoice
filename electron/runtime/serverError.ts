// What a local server's death means for the user, read from its stderr tail and
// exit code. Patterns are from real failures of whisper.cpp v1.9.1 and llama.cpp
// b9858 on Windows (serverError.test.ts). Order matters: an allocation failure is
// followed by "failed to load / create …", so memory is checked before corrupt.
//
// No 'gpu' or 'port' fault: an unusable GPU never crashes either server (both fall
// back to CPU on their own), and a taken port does not fail on Windows — both
// servers bind it anyway and share it.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { config } from '../utils/config'

type ServerFault = 'memory' | 'corrupt' | 'engine' | 'local'

const MEMORY =
	/out of (?:device )?memory|ErrorOutOfDeviceMemory|failed to allocate|cudaMalloc failed|bad_alloc|failed to create context/iu
const CORRUPT =
	/bad magic|invalid magic|not all tensors loaded|not within the file bounds|corrupted or incomplete|error loading model|failed to load model/iu

// NTSTATUS exit codes of a process the Windows loader could not start: a DLL next
// to the server is missing, of the wrong architecture, or from another build.
const LOADER_FAILURES = new Set([
	0xc0_00_01_35, // STATUS_DLL_NOT_FOUND
	0xc0_00_00_7b, // STATUS_INVALID_IMAGE_FORMAT
	0xc0_00_01_39, // STATUS_ENTRYPOINT_NOT_FOUND
])

export const classify = (
	exitCode: number | null | undefined,
	stderr: string,
): ServerFault => {
	if (MEMORY.test(stderr)) return 'memory'
	if (CORRUPT.test(stderr)) return 'corrupt'
	if (LOADER_FAILURES.has(exitCode ?? 0)) return 'engine'
	return 'local'
}

// Both engines link the Visual C++ runtime from System32 (whisper-server.exe imports
// MSVCP140 / VCRUNTIME140); neither their archives nor Electron ship it. On a
// Windows without it every start fails with STATUS_DLL_NOT_FOUND, and "download the
// engine again" would not help.
const VC_RUNTIME = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']
export const missingVcRuntime = (
	system32 = path.join(config.systemRoot, 'System32'),
) => VC_RUNTIME.filter((dll) => !fs.existsSync(path.join(system32, dll)))
