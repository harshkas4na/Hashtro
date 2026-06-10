import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/components/WalletContextProvider";
// import AccessGate from "@/components/AccessGate";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
	weight: ["300", "400", "500", "600", "700"],
	display: "swap",
});

const spaceGrotesk = Space_Grotesk({
	subsets: ["latin"],
	variable: "--font-space-grotesk",
	weight: ["300", "400", "500", "600", "700"],
	display: "swap",
});


export const metadata: Metadata = {
	metadataBase: new URL("https://hashtro.fun"),
	title: "Hashtro - Trade Verified Horoscopes on Solana",
	description:
		"Trade Verified Horoscopes on Solana",
	keywords: ["horoscope", "astrology", "solana", "crypto", "AI", "web3"],
	authors: [{ name: "Hashtro" }],
	icons: {
		icon: "/logo/logo.svg",
		shortcut: "/logo/logo.svg",
		apple: "/logo/logo.svg",
	},
	openGraph: {
		title: "Hashtro - Trade Verified Horoscopes on Solana",
		description: "Trade Verified Horoscopes on Solana",
		type: "website",
		images: [
			{
				url: "/logo/hast.png",
				width: 1200,
				height: 630,
				alt: "Hashtro",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "Hashtro - Trade Verified Horoscopes on Solana",
		description: "Trade Verified Horoscopes on Solana",
		images: ["/logo/hast.png"],
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html className="scroll-smooth" lang="en">
			<body
				className={`${inter.variable} ${spaceGrotesk.variable} font-sans bg-[#0a0a0f] text-white antialiased`}
			>
				<Web3Provider>					
					{children}
				</Web3Provider>
			</body>
		</html>
	);
}
