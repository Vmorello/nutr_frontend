'use client'
import React, { useEffect, useState } from 'react';
import FilterRow from '../../components/FilterRow';
import { createClient } from '@/lib/supabase/client';

type NutrsTotals = Record<string, any> | null;

export default function DietPage() {
    const supabase = createClient()

	const [nutrsTotals, setNutrsTotals] = useState<NutrsTotals>(null);
	const [error, setError] = useState<string | null>(null);

	// --- new search state ---
	const [searchTerm, setSearchTerm] = useState('');
	const [searchResults, setSearchResults] = useState<{ FoodDescription: string; FoodID: string }[]>([]);
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
	const [filters, setFilters] = useState(
		() =>
			[] as {
				id: string;
				foodId?: string;
				foodName: string;
				measurement?: string;
				quantity: number;
				measurementOptions: ConvOption[];
			}[]
	);

	// const addFilter = () =>
	// 	setFilters((s) => [...s, { id: String(Date.now() + Math.random()), foodName: '', measurement: '', value: '' }]);

	const removeFilter = (id: string) => setFilters((s) => s.filter((f) => f.id !== id));

	const updateFilter = (id: string, next: Partial<{ id: string; field: string; measurement: string; quantity: number }>) =>
		setFilters((s) => s.map((f) => (f.id === id ? { ...f, ...next } : f)));
	// --- end filter state ---

	// moved fetch logic to a component-scoped function so it can be reused
	const fetchTotals = async () => {
		try {
			setError(null);
			// build a minimal filters payload for the server
			const payloadFilters = filters.map((f) => ({
				foodId: f.foodId ,
				measureId: f.measurement ,
				quantity: Number(f.quantity ?? 0),
			}));

			const res = await fetch('/api/supabase-function', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ "food_list": payloadFilters }),
			});

            // console.log(res)

			if (!res.ok) {
				const text = await res.text();
				throw new Error(`Fetch error ${res.status}: ${text}`);
			}

			const data = await res.json();
            console.log(data)
			setNutrsTotals((data as any).nutrsTotals ?? (data as any).nutrs_totals ?? (data as any) ?? null);
		} catch (e: any) {
			setError(e?.message ?? String(e));
		}
	};

	// --- new: perform search against server route ---
	const handleSearch = async () => {
		const searchterm = searchTerm.trim();
        // console.log(searchterm)
		if (!searchterm) return;
		try {
			setSearchLoading(true);
			setSearchResults([]);
			setError(null);

			// select only the columns we need and filter with ilike (case-insensitive)
			const { data, error } = await supabase
				.from('FoodName')
				.select('FoodDescription,FoodID')
				.ilike('FoodDescription', `%${searchterm}%`);

			if (error) throw error;

            // console.log(data)
			// data may be null/undefined when nothing found — use empty array
			setSearchResults(Array.isArray(data) ? data : []);
		} catch (e: any) {
			setError(e?.message ?? String(e));
		} finally {
			setSearchLoading(false);
		}
	};

	// when a result is clicked, put the description into the first filter's value (create one if none)
	const selectFood = async (item: { FoodDescription: string; FoodID: string }) => {
		// fetch conversion factor rows for this FoodID, then fetch measurement names separately
		let convOptions: ConvOption[] = [];
		try {
			const { data: convData, error: convError } = await supabase
				.from('ConcersionFactor')
				.select('MeasureID,ConversionFactorValue')
				.eq('FoodID', item.FoodID);

			if (convError) {
				console.error('conversion fetch error', convError);
			} else if (Array.isArray(convData) && convData.length > 0) {
				// collect MeasureIDs then fetch their descriptions from MeasurementName
				const ids = convData.map((c: any) => c.MeasureID).filter(Boolean);
				let nameMap: Record<string, string> = {};

				if (ids.length > 0) {
					const { data: namesData, error: namesError } = await supabase
						.from('MeasurementName')
						.select('MeasureID,MeasureDescription')
						.in('MeasureID', ids);

					if (namesError) {
						console.error('measurement names fetch error', namesError);
					} else if (Array.isArray(namesData)) {
						for (const nd of namesData) {
							if (nd?.MeasureID != null) nameMap[String(nd.MeasureID)] = nd.MeasureDescription ?? '';
						}
					}
				}

				convOptions = convData.map((c: any) => ({
					MeasureID: String(c.MeasureID),
					ConversionFactorValue: c.ConversionFactorValue != null ? Number(c.ConversionFactorValue) : undefined,
					MeasurementName: { MeasureDescription: nameMap[String(c.MeasureID)] ?? undefined },
				}));
			}
		} catch (e) {
			console.error('selectFood error', e);
		}

		const newFilter = {
			id: String(Date.now()) + '_' + item.FoodID,
			foodId: String(item.FoodID), // <-- store FoodID explicitly
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
		416,301,205,208,204,831,825,291,303,304,315,410,305,306,203,319,405,317,307,404,406,418,415,401,324,430,309,815,323,605,606
	]);

	// --- added: CSV generation & download helper ---
	const CSV_FIELDS = ['NutrientID', 'NutrientName', 'WomanMin', 'WomanMax', 'ManMin', 'ManMax', 'total', 'seen_in', 'highest_value', 'highest_id', 'issue_w', 'issue_m'];

	const escapeCsv = (val: any) => {
		if (val == null) return '';
		const s = String(val);
		return `"${s.replace(/"/g, '""')}"`;
	};

	const filteredRows = () =>
		nutrsTotals
			? Object.values(nutrsTotals).filter((v: any) => ALLOWED_NUTR_IDS.has(Number(v?.NutrientID)))
			: [];

	const handleDownloadCsv = () => {
		const rows = filteredRows();
		if (!rows || rows.length === 0) return;

		const csvLines = rows.map((v: any) =>
			CSV_FIELDS
				.map((f) => {
					// try common key forms: exact, lowercase
					const val = v?.[f] ?? v?.[f.toLowerCase()] ?? '';
					return escapeCsv(val);
				})
				.join(',')
		);

		const header = CSV_FIELDS.join(',');
		const csv = [header, ...csvLines].join('\r\n');

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
						.filter(([k, v]) => ALLOWED_NUTR_IDS.has(Number(v?.NutrientID)))
						.map(([k, v]) => (
							<li key={k}>
								{k}: {v['NutrientName']} : {v["total"]}
							</li>
						))}
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