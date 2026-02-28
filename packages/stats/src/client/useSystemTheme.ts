import { useEffect, useState } from "react";

export type SystemTheme = "light" | "dark";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function getSystemTheme(): SystemTheme {
	if (typeof window === "undefined") {
		return "light";
	}

	return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

export function useSystemTheme(): SystemTheme {
	const [theme, setTheme] = useState<SystemTheme>(() => getSystemTheme());

	useEffect(() => {
		const media = window.matchMedia(DARK_SCHEME_QUERY);
		const applyTheme = () => {
			setTheme(media.matches ? "dark" : "light");
		};

		applyTheme();

		media.addEventListener("change", applyTheme);
		return () => media.removeEventListener("change", applyTheme);
	}, []);

	return theme;
}
