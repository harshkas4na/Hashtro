import { FC, useRef, useState } from "react";

export const PlaceAutocomplete: FC<{
	value: string;
	onChange: (value: string) => void;
	disabled: boolean;
	className?: string;
	dropdownClassName?: string;
}> = ({ value, onChange, disabled, className, dropdownClassName }) => {
	const [suggestions, setSuggestions] = useState<any[]>([]);
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [loading, setLoading] = useState(false);
	const timeoutRef = useRef<NodeJS.Timeout>();

	const fetchSuggestions = async (query: string) => {
		if (query.length < 3) {
			setSuggestions([]);
			return;
		}

		setLoading(true);
		try {
			const response = await fetch(
				`https://nominatim.openstreetmap.org/search?` +
					`q=${encodeURIComponent(query)}` +
					`&format=json` +
					`&addressdetails=1` +
					`&limit=5`,
				{
					headers: {
						"User-Agent": "Hastrology-App", 
					},
				},
			);
			const data = await response.json();
			setSuggestions(data || []);
		} catch (error) {
			console.error("Error fetching suggestions:", error);
			setSuggestions([]);
		}
		setLoading(false);
	};

	const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value;
		onChange(newValue);
		setShowSuggestions(true);
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		timeoutRef.current = setTimeout(() => {
			fetchSuggestions(newValue);
		}, 500); 
	};

	const handleSelect = (place: any) => {
		onChange(place.display_name);
		setShowSuggestions(false);
		setSuggestions([]);
	};

	return (
		<div className="relative">
		
			{showSuggestions && suggestions.length > 0 && (
				<ul className={dropdownClassName || "absolute z-50 w-full bottom-full mb-2 bg-[#1F1F1F] border border-[#2A2A2A] rounded-lg shadow-lg max-h-60 overflow-y-auto"}>
					{suggestions.map((suggestion, index) => (
						<li
							key={suggestion.place_id || index}
							onClick={() => handleSelect(suggestion)}
							className="px-4 py-3 hover:bg-[#2A2A2A] cursor-pointer text-white border-b border-[#2A2A2A] last:border-b-0"
						>
							<div className="font-medium">
								{suggestion.address?.city ||
									suggestion.address?.town ||
									suggestion.address?.village ||
									suggestion.name}
							</div>
							<div className="text-sm text-gray-400">
								{suggestion.display_name}
							</div>
						</li>
					))}
				</ul>
			)}

			<input
				className={className || `
                    w-full px-4 py-3 rounded-lg
                    bg-[#121212]
                    border border-[#2A2A2A]
                    text-white
                    placeholder:text-gray-500
                    focus:outline-none
                    focus:border-[#FC5411]
                    disabled:opacity-50
                    disabled:cursor-not-allowed
                `}
				disabled={disabled}
				onChange={handleInput}
				placeholder="Place of Birth (e.g., New York, USA)"
				type="text"
				value={value}
				onFocus={() => setShowSuggestions(true)}
				onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
			/>

			{loading && (
				<div className="absolute right-3 top-4">
					<div className="animate-spin h-5 w-5 border-2 border-[#FC5411] border-t-transparent rounded-full" />
				</div>
			)}
		</div>
	);
};
