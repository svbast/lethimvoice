import type { ButtonHTMLAttributes } from 'react'

interface Props
	extends Pick<
		ButtonHTMLAttributes<HTMLButtonElement>,
		'aria-label' | 'aria-labelledby'
	> {
	on: boolean
	onToggle: () => void
}

/** The on/off switch every tab uses; name it with aria-label or aria-labelledby. */
export default function Switch({ on, onToggle, ...rest }: Props) {
	return (
		<button
			{...rest}
			aria-checked={on}
			className='switch'
			onClick={onToggle}
			role='switch'
			type='button'
		>
			<span className='switch-thumb' />
		</button>
	)
}
