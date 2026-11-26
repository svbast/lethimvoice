/** Mascot loops: one name, several joined by commas, "random", "idle", "sleep" or "splash". */
export class MascotPlayer {
	constructor(el: HTMLCanvasElement, anim: string)
	anim: string
	/** The clock of anim "splash", a performance.now() time in ms. */
	t0: number
	start(): void
	stop(): void
}
