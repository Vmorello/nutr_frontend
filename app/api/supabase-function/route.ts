import { NextResponse } from 'next/server';

export async function POST(req: Request) {
	const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const SUPABASE_SERVICE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

	if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
		return new Response('Server missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', { status: 500 });
	}

	try {
		const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/GetNutr_POST`;
		const body = await req.json();
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
			},
			body: JSON.stringify(body),
		});

		// Read raw text so we can decide whether to parse as JSON or return as-is
		const text = await res.text();
		const contentType = res.headers.get('content-type') || '';

		// Helpful debug output (can be removed later)
		console.log('Upstream content-type:', contentType);
		console.log('Upstream body:', text);

		if (!res.ok) {
			// return upstream error body and status
			return new Response(text || 'Upstream error', { status: res.status });
		}

		// If upstream returned JSON, parse it and return as JSON response
		if (contentType.includes('application/json')) {
			try {
				const parsed = JSON.parse(text);
				return NextResponse.json(parsed, { status: 200 });
			} catch (parseErr) {
				console.warn('Failed to parse upstream JSON, returning raw text', parseErr);
				return new Response(text, { status: 200, headers: { 'content-type': contentType } });
			}
		}

		// Non-JSON response: return raw text and preserve content-type
		return new Response(text, { status: 200, headers: { 'content-type': contentType } });
	} catch (err: unknown) {
		return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
	}
}