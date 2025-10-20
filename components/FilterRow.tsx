import React from 'react';

type Filter = {
	id: string;
	foodName: string;
	measurement?: string;
	quantity: number;
	measurementOptions: {
		MeasureID: string;
		MeasurementName: { MeasureDescription?: string };
	}[];
};

type Props = {
	filter: Filter;
	onChange: (id: string, next: Partial<Filter>) => void;
	onRemove: (id: string) => void;
};

export default function FilterRow({ filter, onChange, onRemove }: Props) {

	return (
		<div className="flex items-center gap-2 p-2 border rounded-md">
			<label className="min-w-[180px]">{filter.foodName}</label>

			<select
				className="px-2 py-1 border rounded"
				value={filter.measurement ?? ''}
				onChange={(e) => onChange(filter.id, { measurement: e.target.value })}
			>
				<option value="">Select measurement</option>
				{/* render options fetched from ConcersionFactor */}
				{(filter.measurementOptions ?? []).map((opt) => (
					<option key={opt.MeasureID} value={opt.MeasureID}>
                        {opt.MeasurementName.MeasureDescription}
					</option>
				))}
			</select>

            <input
				type='number'
				className="px-2 py-1 border rounded w-36"
				value={filter.quantity}
				onChange={(e) => onChange(filter.id, { quantity: Number(e.target.value) })}
			/>

			<button
				type="button"
				onClick={() => onRemove(filter.id)}
				className="ml-auto text-sm text-red-600 px-2 py-1 hover:bg-red-50 rounded"
				aria-label="Remove filter"
			>
				x
			</button>
		</div>
	);
}
