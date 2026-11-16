const KST_MS = 9 * 3600 * 1000;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

export function kstParts(d: Date) {
	const k = new Date(d.getTime() + KST_MS);
	return {
		y: k.getUTCFullYear(),
		mo: k.getUTCMonth() + 1,
		d: k.getUTCDate(),
		dow: DOW[k.getUTCDay()] as string,
		secOfDay: k.getUTCHours() * 3600 + k.getUTCMinutes() * 60 + k.getUTCSeconds(),
	};
}

function parseHm(s: string): number {
	const [h, m] = s.split(":").map(Number);
	return (h as number) * 3600 + (m as number) * 60;
}

/** Peak is decided by the request START instant, in KST. Windows are [start, end). */
export function isPeak(start: Date, windows: { days: string[]; hours: string[] }, holidays: string[]): boolean {
	const p = kstParts(start);
	if (holidays.includes(`${p.y}-${pad(p.mo)}-${pad(p.d)}`)) return false;
	if (!windows.days.includes(p.dow)) return false;
	return windows.hours.some((w) => {
		const [a, b] = w.split("-") as [string, string];
		return p.secOfDay >= parseHm(a) && p.secOfDay < parseHm(b);
	});
}

export function kstMonthKey(d: Date): string {
	const p = kstParts(d);
	return `${p.y}-${pad(p.mo)}`;
}

export function nextKstMonthStart(d: Date): Date {
	const p = kstParts(d);
	return new Date(Date.UTC(p.y, p.mo, 1) - KST_MS);
}

export function secondsUntil(from: Date, to: Date): number {
	return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 1000));
}

export function formatKst(d: Date): string {
	const p = kstParts(d);
	const hh = Math.floor(p.secOfDay / 3600);
	const mm = Math.floor((p.secOfDay % 3600) / 60);
	return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(hh)}:${pad(mm)} KST`;
}

export function isoKst(d: Date): string {
	const p = kstParts(d);
	const hh = Math.floor(p.secOfDay / 3600);
	const mm = Math.floor((p.secOfDay % 3600) / 60);
	const ss = p.secOfDay % 60;
	return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}+09:00`;
}
