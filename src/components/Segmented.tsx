// Segmented control for small, fixed option sets (e.g. language pickers).
// Presentational only — same { value, onChange } contract as a <select>, so it
// drops in wherever a short list of choices reads better as inline segments.
interface Props {
	value: string
	options: { value: string; label: string }[]
	onChange: (value: string) => void
	ariaLabel: string
}

export default function Segmented({
	value,
	options,
	onChange,
	ariaLabel,
}: Props) {
	return (
		<div aria-label={ariaLabel} className='seg' role='radiogroup'>
			{options.map((opt) => (
				// biome-ignore lint/a11y/useSemanticElements: styled segment; a native radio input cannot render this appearance
				<button
					aria-checked={value === opt.value}
					className='seg-item'
					key={opt.value}
					onClick={() => onChange(opt.value)}
					role='radio'
					type='button'
				>
					{opt.label}
				</button>
			))}
		</div>
	)
}
