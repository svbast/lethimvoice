// The app's pixel icons, drawn on a 10 × 10 or 8 × 8 grid and filled with the
// current colour.
const ICONS = {
	about: [
		10,
		'M3 0h4v1h-4zM1 1h2v1h-2zM7 1h2v1h-2zM1 2h1v1h-1zM4 2h2v1h-2zM8 2h1v1h-1zM0 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM4 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM4 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM4 6h2v1h-2zM9 6h1v1h-1zM1 7h1v1h-1zM4 7h2v1h-2zM8 7h1v1h-1zM1 8h2v1h-2zM7 8h2v1h-2zM3 9h4v1h-4z',
	],
	arrowRight: [
		8,
		'M4 1h1v1h-1zM5 2h1v1h-1zM0 3h7v1h-7zM0 4h7v1h-7zM5 5h1v1h-1zM4 6h1v1h-1z',
	],
	assistant: [
		10,
		'M4 0h2v1h-2zM4 1h2v1h-2zM1 2h8v1h-8zM0 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM2 4h2v1h-2zM6 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h2v1h-2zM6 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM0 7h1v1h-1zM3 7h4v1h-4zM9 7h1v1h-1zM1 8h8v1h-8z',
	],
	chat: [
		10,
		'M1 1h8v1h-8zM0 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM4 3h1v1h-1zM6 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM9 4h1v1h-1zM1 5h1v1h-1zM3 5h6v1h-6zM1 6h2v1h-2zM1 7h1v1h-1z',
	],
	check: [
		8,
		'M7 1h1v1h-1zM6 2h2v1h-2zM0 3h1v1h-1zM5 3h2v1h-2zM0 4h2v1h-2zM4 4h2v1h-2zM1 5h4v1h-4zM2 6h2v1h-2z',
	],
	chevronDown: [
		8,
		'M0 2h2v1h-2zM6 2h2v1h-2zM1 3h2v1h-2zM5 3h2v1h-2zM2 4h4v1h-4zM3 5h2v1h-2z',
	],
	clean: [
		10,
		'M4 0h1v1h-1zM4 1h1v1h-1zM3 2h3v1h-3zM1 3h7v1h-7zM3 4h3v1h-3zM4 5h1v1h-1zM4 6h1v1h-1zM8 6h1v1h-1zM7 7h3v1h-3zM8 8h1v1h-1z',
	],
	close: [
		8,
		'M0 0h2v1h-2zM6 0h2v1h-2zM0 1h3v1h-3zM5 1h3v1h-3zM1 2h6v1h-6zM2 3h4v1h-4zM1 4h6v1h-6zM0 5h3v1h-3zM5 5h3v1h-3zM0 6h2v1h-2zM6 6h2v1h-2z',
	],
	code: [
		8,
		'M2 1h1v1h-1zM5 1h1v1h-1zM1 2h2v1h-2zM5 2h2v1h-2zM0 3h2v1h-2zM6 3h2v1h-2zM1 4h2v1h-2zM5 4h2v1h-2zM2 5h1v1h-1zM5 5h1v1h-1z',
	],
	coin: [
		10,
		'M2 0h6v1h-6zM1 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM3 2h4v1h-4zM9 2h1v1h-1zM0 3h1v1h-1zM3 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM3 4h4v1h-4zM9 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM0 6h1v1h-1zM3 6h4v1h-4zM9 6h1v1h-1zM0 7h1v1h-1zM9 7h1v1h-1zM1 8h1v1h-1zM8 8h1v1h-1zM2 9h6v1h-6z',
	],
	copy: [
		8,
		'M2 0h6v1h-6zM2 1h1v1h-1zM7 1h1v1h-1zM0 2h3v1h-3zM7 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM2 4h6v1h-6zM0 5h1v1h-1zM5 5h1v1h-1zM0 6h6v1h-6z',
	],
	download: [
		8,
		'M3 0h2v1h-2zM3 1h2v1h-2zM3 2h2v1h-2zM1 3h6v1h-6zM2 4h4v1h-4zM3 5h2v1h-2zM0 6h1v1h-1zM7 6h1v1h-1zM0 7h8v1h-8z',
	],
	email: [
		10,
		'M0 1h10v1h-10zM0 2h2v1h-2zM8 2h2v1h-2zM0 3h1v1h-1zM2 3h1v1h-1zM7 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM3 4h1v1h-1zM6 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM4 5h2v1h-2zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM0 7h1v1h-1zM9 7h1v1h-1zM0 8h10v1h-10z',
	],
	external: [
		8,
		'M2 0h6v1h-6zM6 1h2v1h-2zM5 2h3v1h-3zM4 3h2v1h-2zM7 3h1v1h-1zM3 4h2v1h-2zM7 4h1v1h-1zM2 5h2v1h-2zM1 6h2v1h-2zM0 7h2v1h-2z',
	],
	eye: [
		8,
		'M2 1h4v1h-4zM1 2h2v1h-2zM5 2h2v1h-2zM0 3h2v1h-2zM3 3h2v1h-2zM6 3h2v1h-2zM0 4h2v1h-2zM3 4h2v1h-2zM6 4h2v1h-2zM1 5h2v1h-2zM5 5h2v1h-2zM2 6h4v1h-4z',
	],
	eyeOff: [
		8,
		'M2 1h4v1h-4zM1 2h2v1h-2zM5 2h2v1h-2zM0 3h2v1h-2zM3 3h2v1h-2zM6 3h2v1h-2zM0 4h2v1h-2zM3 4h2v1h-2zM6 4h2v1h-2zM1 5h2v1h-2zM5 5h2v1h-2zM2 6h4v1h-4zM7 0h1v1h-1zM6 1h1v1h-1zM5 2h1v1h-1zM4 3h1v1h-1zM3 4h1v1h-1zM2 5h1v1h-1zM1 6h1v1h-1zM0 7h1v1h-1z',
	],
	feedback: [
		8,
		'M0 0h8v1h-8zM0 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM2 2h4v1h-4zM7 2h1v1h-1zM0 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM2 4h2v1h-2zM7 4h1v1h-1zM0 5h8v1h-8zM1 6h2v1h-2zM1 7h1v1h-1z',
	],
	history: [
		10,
		'M3 0h4v1h-4zM1 1h2v1h-2zM7 1h2v1h-2zM1 2h1v1h-1zM4 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM4 3h1v1h-1zM9 3h1v1h-1zM0 4h1v1h-1zM4 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM4 5h3v1h-3zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM1 7h1v1h-1zM8 7h1v1h-1zM1 8h2v1h-2zM7 8h2v1h-2zM3 9h4v1h-4z',
	],
	home: [
		10,
		'M4 0h2v1h-2zM3 1h4v1h-4zM2 2h2v1h-2zM6 2h2v1h-2zM1 3h2v1h-2zM7 3h2v1h-2zM0 4h2v1h-2zM8 4h2v1h-2zM1 5h1v1h-1zM8 5h1v1h-1zM1 6h1v1h-1zM4 6h2v1h-2zM8 6h1v1h-1zM1 7h1v1h-1zM4 7h2v1h-2zM8 7h1v1h-1zM1 8h1v1h-1zM4 8h2v1h-2zM8 8h1v1h-1zM1 9h8v1h-8z',
	],
	issue: [
		8,
		'M2 0h4v1h-4zM1 1h1v1h-1zM3 1h2v1h-2zM6 1h1v1h-1zM0 2h1v1h-1zM3 2h2v1h-2zM7 2h1v1h-1zM0 3h1v1h-1zM3 3h2v1h-2zM7 3h1v1h-1zM0 4h1v1h-1zM7 4h1v1h-1zM0 5h1v1h-1zM3 5h2v1h-2zM7 5h1v1h-1zM1 6h1v1h-1zM6 6h1v1h-1zM2 7h4v1h-4z',
	],
	keyboard: [
		8,
		'M0 1h8v1h-8zM0 2h1v1h-1zM2 2h1v1h-1zM4 2h1v1h-1zM6 2h2v1h-2zM0 3h8v1h-8zM0 4h1v1h-1zM2 4h4v1h-4zM7 4h1v1h-1zM0 5h8v1h-8z',
	],
	local: [
		10,
		'M2 0h1v1h-1zM4 0h2v1h-2zM7 0h1v1h-1zM0 2h1v1h-1zM2 2h6v1h-6zM9 2h1v1h-1zM2 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM4 4h2v1h-2zM7 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h1v1h-1zM4 5h2v1h-2zM7 5h1v1h-1zM9 5h1v1h-1zM2 6h1v1h-1zM7 6h1v1h-1zM0 7h1v1h-1zM2 7h6v1h-6zM9 7h1v1h-1zM2 9h1v1h-1zM4 9h2v1h-2zM7 9h1v1h-1z',
	],
	mic: [
		10,
		'M3 0h4v1h-4zM3 1h1v1h-1zM6 1h1v1h-1zM3 2h1v1h-1zM6 2h1v1h-1zM3 3h1v1h-1zM6 3h1v1h-1zM1 4h1v1h-1zM3 4h1v1h-1zM6 4h1v1h-1zM8 4h1v1h-1zM1 5h1v1h-1zM3 5h4v1h-4zM8 5h1v1h-1zM2 6h1v1h-1zM7 6h1v1h-1zM3 7h4v1h-4zM4 8h2v1h-2zM2 9h6v1h-6z',
	],
	minimize: [8, 'M1 4h6v1h-6zM1 5h6v1h-6z'],
	online: [
		10,
		'M3 1h3v1h-3zM2 2h1v1h-1zM6 2h1v1h-1zM1 3h1v1h-1zM7 3h2v1h-2zM1 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM1 7h8v1h-8z',
	],
	pencil: [
		8,
		'M5 0h2v1h-2zM4 1h1v1h-1zM7 1h1v1h-1zM3 2h1v1h-1zM6 2h1v1h-1zM2 3h1v1h-1zM5 3h1v1h-1zM1 4h1v1h-1zM4 4h1v1h-1zM1 5h3v1h-3zM0 6h2v1h-2z',
	],
	plus: [
		10,
		'M4 1h2v1h-2zM4 2h2v1h-2zM4 3h2v1h-2zM1 4h8v1h-8zM1 5h8v1h-8zM4 6h2v1h-2zM4 7h2v1h-2zM4 8h2v1h-2z',
	],
	prompts: [
		10,
		'M1 1h8v1h-8zM0 2h1v1h-1zM9 2h1v1h-1zM0 3h1v1h-1zM2 3h6v1h-6zM9 3h1v1h-1zM0 4h1v1h-1zM9 4h1v1h-1zM0 5h1v1h-1zM2 5h4v1h-4zM9 5h1v1h-1zM0 6h1v1h-1zM9 6h1v1h-1zM1 7h1v1h-1zM3 7h6v1h-6zM1 8h2v1h-2zM1 9h1v1h-1z',
	],
	raw: [
		10,
		'M4 1h1v1h-1zM4 2h1v1h-1zM7 2h1v1h-1zM1 3h1v1h-1zM4 3h1v1h-1zM7 3h1v1h-1zM1 4h1v1h-1zM3 4h2v1h-2zM6 4h2v1h-2zM9 4h1v1h-1zM0 5h2v1h-2zM3 5h2v1h-2zM6 5h2v1h-2zM9 5h1v1h-1zM1 6h1v1h-1zM4 6h1v1h-1zM7 6h1v1h-1zM4 7h1v1h-1zM7 7h1v1h-1zM4 8h1v1h-1z',
	],
	record: [10, 'M3 1h4v1h-4zM2 2h6v1h-6zM1 3h8v4h-8zM2 7h6v1h-6zM3 8h4v1h-4z'],
	restart: [
		8,
		'M2 0h4v1h-4zM7 0h1v1h-1zM1 1h2v1h-2zM5 1h3v1h-3zM0 2h2v1h-2zM5 2h3v1h-3zM0 3h1v1h-1zM7 4h1v1h-1zM0 5h3v1h-3zM6 5h2v1h-2zM0 6h3v1h-3zM5 6h2v1h-2zM0 7h1v1h-1zM2 7h4v1h-4z',
	],
	rewrite: [
		10,
		'M7 0h2v1h-2zM6 1h1v1h-1zM9 1h1v1h-1zM5 2h1v1h-1zM8 2h1v1h-1zM4 3h1v1h-1zM7 3h1v1h-1zM3 4h1v1h-1zM6 4h1v1h-1zM2 5h1v1h-1zM5 5h1v1h-1zM1 6h1v1h-1zM4 6h1v1h-1zM1 7h3v1h-3zM0 8h2v1h-2z',
	],
	search: [
		8,
		'M1 0h4v1h-4zM0 1h2v1h-2zM4 1h2v1h-2zM0 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM5 3h1v1h-1zM0 4h2v1h-2zM4 4h2v1h-2zM1 5h5v1h-5zM5 6h2v1h-2zM6 7h2v1h-2z',
	],
	settings: [
		10,
		'M1 1h2v1h-2zM0 2h10v1h-10zM1 3h2v1h-2zM6 6h2v1h-2zM0 7h10v1h-10zM6 8h2v1h-2z',
	],
	stats: [
		10,
		'M7 1h2v1h-2zM7 2h2v1h-2zM4 3h2v1h-2zM7 3h2v1h-2zM4 4h2v1h-2zM7 4h2v1h-2zM1 5h2v1h-2zM4 5h2v1h-2zM7 5h2v1h-2zM1 6h2v1h-2zM4 6h2v1h-2zM7 6h2v1h-2zM1 7h2v1h-2zM4 7h2v1h-2zM7 7h2v1h-2zM0 8h10v1h-10z',
	],
	todo: [
		10,
		'M0 1h2v1h-2zM4 1h6v1h-6zM0 2h2v1h-2zM0 4h2v1h-2zM4 4h6v1h-6zM0 5h2v1h-2zM0 7h2v1h-2zM4 7h6v1h-6zM0 8h2v1h-2z',
	],
	translate: [
		10,
		'M3 0h4v1h-4zM1 1h2v1h-2zM4 1h2v1h-2zM7 1h2v1h-2zM1 2h1v1h-1zM4 2h2v1h-2zM8 2h1v1h-1zM0 3h10v1h-10zM0 4h1v1h-1zM4 4h2v1h-2zM9 4h1v1h-1zM0 5h1v1h-1zM4 5h2v1h-2zM9 5h1v1h-1zM0 6h10v1h-10zM1 7h1v1h-1zM4 7h2v1h-2zM8 7h1v1h-1zM1 8h2v1h-2zM4 8h2v1h-2zM7 8h2v1h-2zM3 9h4v1h-4z',
	],
	trash: [
		8,
		'M3 0h2v1h-2zM0 1h8v1h-8zM1 2h1v1h-1zM6 2h1v1h-1zM1 3h1v1h-1zM3 3h2v1h-2zM6 3h1v1h-1zM1 4h1v1h-1zM3 4h2v1h-2zM6 4h1v1h-1zM1 5h1v1h-1zM3 5h2v1h-2zM6 5h1v1h-1zM1 6h6v1h-6z',
	],
	x: [
		8,
		'M0 0h2v1h-2zM6 0h2v1h-2zM1 1h2v1h-2zM5 1h2v1h-2zM2 2h4v1h-4zM3 3h2v1h-2zM3 4h2v1h-2zM2 5h4v1h-4zM1 6h2v1h-2zM5 6h2v1h-2zM0 7h2v1h-2zM6 7h2v1h-2z',
	],
	zap: [
		10,
		'M5 0h3v1h-3zM4 1h3v1h-3zM3 2h3v1h-3zM2 3h6v1h-6zM5 4h2v1h-2zM4 5h2v1h-2zM3 6h2v1h-2zM2 7h2v1h-2zM1 8h1v1h-1z',
	],
} as const satisfies Record<string, readonly [number, string]>

export type IconName = keyof typeof ICONS

export default function PixelIcon({
	name,
	className,
}: {
	name: IconName
	className?: string
}) {
	const [grid, d] = ICONS[name]
	return (
		<svg
			aria-hidden='true'
			className={className ? `pxi ${className}` : 'pxi'}
			viewBox={`0 0 ${grid} ${grid}`}
		>
			<path d={d} />
		</svg>
	)
}
