'use client'
import React, { useEffect, useState } from 'react';
import FilterRow from '../../components/FilterRow';
import { createClient } from '@/lib/supabase/client';

// --- types to avoid `any` ---
type NutrientValue = string | number | null | undefined;

export interface NutrientRow {
	// common fields used in the UI / CSV
	NutrientID?: number | string;
	NutrientName?: string;
	total?: number | string;
	seen_in?: number | string;
	highest_value?: number | string;
	highest_id?: number | string;
	issue_w?: string | number;
	issue_m?: string | number;
	WomanMin?: number | string;
	WomanMax?: number | string;
	ManMin?: number | string;
	ManMax?: number | string;
	// allow additional fields by key
	[key: string]: NutrientValue;
}

type NutrsTotals = Record<string, NutrientRow> | null;

type FoodSearchItem = {
	FoodDescription: string;
	FoodID: string;
};

type ConvOption = {
	MeasureID: string;
	ConversionFactorValue?: number;
	MeasurementName: { MeasureDescription?: string } ;
};

type FilterItem = {
	id: string;
	foodId?: string;
	foodName: string;
	measurement?: string;
	quantity: number;
	measurementOptions: ConvOption[];
};
// --- end types ---

export default function DietPage() {
	const supabase = createClient();

	const [nutrsTotals, setNutrsTotals] = useState<NutrsTotals>(null);
	const [error, setError] = useState<string | null>(null);

	// --- new search state ---
	const [searchTerm, setSearchTerm] = useState('');
	const [searchResults, setSearchResults] = useState<FoodSearchItem[]>([]);
	const [searchLoading, setSearchLoading] = useState(false);
	// --- end search state ---

	// --- new filter state ---
	// measurementOptions will hold the fetched conversion factor rows
	type ConvOption = {
		MeasureID: string;
		ConversionFactorValue?: number;
		MeasurementName: { MeasureDescription?: string };
	};

	// include foodId so fetchTotals can send the necessary identifiers
	const [filters, setFilters] = useState<FilterItem[]>(
		() =>
			[] as FilterItem[]
	);

	const removeFilter = (id: string) => setFilters((s) => s.filter((f) => f.id !== id));

	const updateFilter = (id: string, next: Partial<{ id: string; field: string; measurement: string; quantity: number }>) =>
		setFilters((s) => s.map((f) => (f.id === id ? { ...f, ...next } : f)));
	// --- end filter state ---

	// helper to extract string message from unknown error
	const extractErrorMessage = (e: unknown) => {
		if (!e) return 'Unknown error';
		if (typeof e === 'string') return e;
		if (e instanceof Error) return e.message;
		try {
			return String(e);
		} catch {
			return 'Unknown error';
		}
	};

	// small runtime type-guards
	const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
	const isNutrTotals = (x: unknown): x is Record<string, NutrientRow> => isRecord(x);

	// moved fetch logic to a component-scoped function so it can be reused
	const fetchTotals = async () => {
		try {
			setError(null);
			// build a minimal filters payload for the server
			const payloadFilters = filters.map((f) => ({
				foodId: f.foodId,
				measureId: f.measurement,
				quantity: Number(f.quantity ?? 0),
			}));

			const res = await fetch('/api/supabase-function', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ food_list: payloadFilters }),
			});

			if (!res.ok) {
				const text = await res.text();
				throw new Error(`Fetch error ${res.status}: ${text}`);
			}

			const data = (await res.json()) as unknown;

			// try several known shapes returned by the server
			let totals: Record<string, NutrientRow> | undefined;

			if (isRecord(data)) {
				if ('nutrsTotals' in data && isNutrTotals((data as Record<string, unknown>)['nutrsTotals'])) {
					totals = (data as Record<string, unknown>)['nutrsTotals'] as Record<string, NutrientRow>;
				} else if ('nutrs_totals' in data && isNutrTotals((data as Record<string, unknown>)['nutrs_totals'])) {
					totals = (data as Record<string, unknown>)['nutrs_totals'] as Record<string, NutrientRow>;
				} else if (isNutrTotals(data)) {
					totals = data as Record<string, NutrientRow>;
				}
			}

			setNutrsTotals(totals ?? null);
		} catch (e: unknown) {
			setError(extractErrorMessage(e));
		}
	};

	// --- new: perform search against server route ---
	const handleSearch = async () => {
		const searchterm = searchTerm.trim();
		if (!searchterm) return;
		try {
			setSearchLoading(true);
			setSearchResults([]);
			setError(null);

			const { data, error } = await supabase
				.from('FoodName')
				.select('FoodDescription,FoodID')
				.ilike('FoodDescription', `%${searchterm}%`);

			if (error) throw error;

			if (Array.isArray(data)) {
				// coerce each entry to FoodSearchItem where possible
				const typed: FoodSearchItem[] = (data as unknown[]).reduce<FoodSearchItem[]>((acc, item) => {
					if (isRecord(item)) {
						const desc = (item as Record<string, unknown>)['FoodDescription'];
						const id = (item as Record<string, unknown>)['FoodID'];
						if (typeof desc === 'string' && (typeof id === 'string' || typeof id === 'number')) {
							acc.push({ FoodDescription: desc, FoodID: String(id) });
						}
					}
					return acc;
				}, []);
				setSearchResults(typed);
			} else {
				setSearchResults([]);
			}
		} catch (e: unknown) {
			setError(extractErrorMessage(e));
		} finally {
			setSearchLoading(false);
		}
	};

	// when a result is clicked, put the description into the first filter's value (create one if none)
	const selectFood = async (item: FoodSearchItem) => {
		let convOptions: ConvOption[] = [];
		try {
			const { data: convData, error: convError } = await supabase
				.from('ConcersionFactor')
				.select('MeasureID,ConversionFactorValue')
				.eq('FoodID', item.FoodID);

			if (convError) {
				console.error('conversion fetch error', convError);
			} else if (Array.isArray(convData) && convData.length > 0) {
				const ids = convData
					.map((c) => (isRecord(c) ? (c['MeasureID'] ?? undefined) : undefined))
					.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
					.map(String);

				const nameMap: Record<string, string> = {};

				if (ids.length > 0) {
					const { data: namesData, error: namesError } = await supabase
						.from('MeasurementName')
						.select('MeasureID,MeasureDescription')
						.in('MeasureID', ids);

					if (namesError) {
						console.error('measurement names fetch error', namesError);
					} else if (Array.isArray(namesData)) {
						for (const nd of namesData) {
							if (isRecord(nd)) {
								const mid = nd['MeasureID'];
								const desc = nd['MeasureDescription'];
								if ((typeof mid === 'string' || typeof mid === 'number') && typeof desc === 'string') {
									nameMap[String(mid)] = desc;
								}
							}
						}
					}
				}

				convOptions = convData.reduce<ConvOption[]>((acc, c) => {
					if (isRecord(c)) {
						const mid = c['MeasureID'];
						const cf = c['ConversionFactorValue'];
						if ((typeof mid === 'string' || typeof mid === 'number')) {
							acc.push({
								MeasureID: String(mid),
								ConversionFactorValue: typeof cf === 'number' ? cf : cf == null ? undefined : Number(cf),
								MeasurementName: { MeasureDescription: nameMap[String(mid)] ?? undefined },
							});
						}
					}
					return acc;
				}, []);
			}
		} catch (e) {
			console.error('selectFood error', e);
		}

		const newFilter: FilterItem = {
			id: String(Date.now()) + '_' + item.FoodID,
			foodId: String(item.FoodID),
			foodName: item.FoodDescription,
			measurement: convOptions.length > 0 ? convOptions[0].MeasureID : undefined,
			quantity: 1,
			measurementOptions: convOptions,
		};

		setFilters((s) => {
			const next = s.slice();
			next.push(newFilter);
			return next;
		});
		// clear search results after selection
		setSearchResults([]);
		setSearchTerm('');
	};
	// --- end search helpers ---

	useEffect(() => {
		fetchTotals();
	}, []);

	// Allowed nutrient IDs to display
	const ALLOWED_NUTR_IDS = new Set<number>([
		416,301,205,208,204,814, 831,825,291,303,304,315,410,305,306,203,319,405,317,307,404,406,418,415,401,324,430,309,815,323,605,606
	]);

	// --- added: CSV generation & download helper ---
	const CSV_FIELDS = ['NutrientID', 'NutrientName', 'WomanMin', 'WomanMax', 'ManMin', 'ManMax', 'total', 'seen_in', 'highest_value', 'highest_id', 'issue_w', 'issue_m'];

	const escapeCsv = (val: unknown) => {
		if (val == null) return '';
		const s = String(val);
		return `"${s.replace(/"/g, '""')}"`;
	};

	const filteredRows = () =>
		nutrsTotals
			? Object.values(nutrsTotals).filter((v) => ALLOWED_NUTR_IDS.has(Number(v?.NutrientID)))
			: [];

	const handleDownloadCsv = () => {
		const rows = filteredRows();
		if (!rows || rows.length === 0) return;

		const csvLines = rows.map((v) =>
			CSV_FIELDS
				.map((f) => {
					const rv = (v as Record<string, unknown>)[f] ?? (v as Record<string, unknown>)[f.toLowerCase()];
					return escapeCsv(rv);
				})
				.join(',')
		);

		const header = CSV_FIELDS.join(',');
		const csvSections: string[] = [header, ...csvLines];

		if (filters && filters.length > 0) {
			csvSections.push(''); // blank line separator
			csvSections.push('Selected Filters:');
			csvSections.push('Food,Quantity,Measurement');
			for (const f of filters) {
				const measureLabel =
					(f.measurementOptions ?? []).find((o) => o.MeasureID === f.measurement)?.MeasurementName?.MeasureDescription ??
					f.measurement ?? '';
				csvSections.push([
					escapeCsv(f.foodName ?? ''),
					escapeCsv(f.quantity),
					escapeCsv(measureLabel),
				].join(','));
			}
		}

		const csv = csvSections.join('\r\n');

		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'nutrs_totals.csv';
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	};
	// --- end CSV helper ---

	// --- added: helpers to read/format issue fields ---
	const readField = (obj: unknown, key: string): unknown => {
		if (!isRecord(obj)) return undefined;
		const r = obj[key] ?? obj[key.toLowerCase()] ?? obj[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
		return r;
	};

	const formatIssues = (v: NutrientRow) => {
		const iw = readField(v, 'issue_w');
		const im = readField(v, 'issue_m');
		const parts: string[] = [];
		if (iw != null && String(iw).trim() !== '') parts.push(`w:${String(iw)}`);
		if (im != null && String(im).trim() !== '') parts.push(`m:${String(im)}`);
		return parts.length ? parts.join(' | ') : null;
	};
	// --- end helpers ---

	return (
		<div>
			<h1>Diet — Nutrient Totals</h1>

			{/* Search bar (above filters) */}
			<div className="mb-4">
				<div className="flex gap-2 items-center">
					<input
						type="text"
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						placeholder="Search food descriptions..."
						className="flex-1 px-3 py-2 border rounded"
						onKeyDown={(e) => {
							if (e.key === 'Enter') handleSearch();
						}}
					/>
					<button
						type="button"
						onClick={handleSearch}
						className="px-3 py-2 border border-gray-300 rounded  hover:bg-gray-500"
						disabled={searchLoading}
					>
						{searchLoading ? 'Searching...' : 'Search'}
					</button>
				</div>

				{/* Search results */}
				{searchResults.length > 0 && (
					<ul className="mt-2 border rounded max-h-40 overflow-auto ">
						{searchResults.map((r) => (
							<li
								key={r.FoodID}
								className="px-3 py-2 hover:bg-gray-500 flex justify-between items-center cursor-pointer"
								onClick={() => selectFood(r)}
							>
								<span>{r.FoodDescription}</span>
								<small className="text-gray-500 ml-2">ID: {r.FoodID}</small>
							</li>
						))}
					</ul>
				)}
			</div>

			{/* Filters area - above the Refresh button */}
			<div className="space-y-2 mb-3">
				{filters.map((f) => (
					<FilterRow key={f.id} filter={f} onChange={updateFilter} onRemove={removeFilter} />
				))}
			</div>

			{/* Refresh button placed before the loading/content area */}
			<button
				onClick={() => fetchTotals()}
				className="mb-3 border border-gray-300 rounded px-3 py-1 hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
			>
				Send & recalculate
			</button>

			{error && <div style={{ color: 'red' }}>{error}</div>}
			{!error && nutrsTotals === null && <div>Loading...</div>}
			{nutrsTotals && (
				<ul>
					{Object.entries(nutrsTotals)
						.filter(([, v]) => ALLOWED_NUTR_IDS.has(Number(v?.NutrientID)))
						.map(([k, v]) => {
							const issues = formatIssues(v);
							return (
								<li key={k}>
									{k}: {v['NutrientName']} : {v['total']}
									{/* show issue info if present */}
									{issues && <small className="text-red-600 ml-2">[{issues}]</small>}
								</li>
							);
						})}
				</ul>
			)}

			{/* Download CSV button at very bottom */}
			<div className="mt-4">
				<button
					type="button"
					onClick={handleDownloadCsv}
					disabled={filteredRows().length === 0}
					className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-500 disabled:opacity-50"
				>
					Download CSV
				</button>
			</div>
		</div>
	);
}